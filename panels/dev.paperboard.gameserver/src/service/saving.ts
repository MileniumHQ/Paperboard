import { files as fileApi, processApi, type ServiceContext } from "@mileniumhq/paperapi";
import { PANEL_ID, SERVER_PROC_ID, type GameServerState } from "./types";

// Copying a running world: the server writes region files whenever it
// autosaves, so a copy taken meanwhile can catch half a write. Saving is
// switched off (save-off), everything in memory is written out
// (save-all flush), the copy is made, and saving is switched back on.
// A marker file records the pause, so a service that died mid-copy turns
// saving back on when it starts and finds the server still running.

const PAUSED_MARKER = ".paperboard-saving-paused";
const FLUSH_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 15_000;

type Waiter = { match: (line: string) => boolean; resolve: () => void };
// at most one pause at a time, so at most two waiters (off, flushed)
const waiters = new Set<Waiter>();
let pausing = false;

/** every console line passes here (lifecycle.handleProcessData) */
export function observeSavingLine(line: string): void {
    for (const waiter of waiters) {
        if (waiter.match(line)) {
            waiters.delete(waiter);
            waiter.resolve();
        }
    }
}

function waitForLine(match: (line: string) => boolean, timeoutMs: number, what: string): { done: Promise<void>; cancel: () => void } {
    let waiter!: Waiter;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve, reject) => {
        waiter = { match, resolve: () => { clearTimeout(timer); resolve(); } };
        timer = setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`The server did not confirm ${what} within ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);
        waiters.add(waiter);
    });
    return { done, cancel: () => { clearTimeout(timer); waiters.delete(waiter); } };
}

// "Automatic saving is now disabled", "Saving is already turned off"
const savingOff = (line: string) => /saving is (now disabled|already turned off)/i.test(line);
// "Saved the game", "Saved the world"
const flushed = (line: string) => /Saved the (game|world)/i.test(line);

async function send(command: string, confirm: (line: string) => boolean, timeoutMs: number, what: string): Promise<void> {
    const wait = waitForLine(confirm, timeoutMs, what);
    try {
        await processApi.write(SERVER_PROC_ID, `${command}\n`);
    } catch (err) {
        wait.cancel();
        throw err;
    }
    await wait.done;
}

/**
 * Runs `work` with the server's saving paused when the server is running;
 * an offline server writes nothing, so `work` just runs. Saving is turned
 * back on however `work` ends.
 */
export async function withSavingPaused<T>(ctx: ServiceContext<GameServerState>, work: () => Promise<T>): Promise<T> {
    if (ctx.state.serverStatus === "offline") return work();
    if (ctx.state.serverStatus !== "online") throw new Error("Wait until the server has finished starting or stopping");
    if (pausing) throw new Error("Saving is already paused for another copy");
    pausing = true;
    try {
        await fileApi.write(PAUSED_MARKER, new Date().toISOString(), PANEL_ID);
        try {
            await send("save-off", savingOff, COMMAND_TIMEOUT_MS, "that saving is paused");
            await send("save-all flush", flushed, FLUSH_TIMEOUT_MS, "that the world is saved");
            return await work();
        } finally {
            await resumeSaving();
        }
    } finally {
        pausing = false;
    }
}

async function resumeSaving(): Promise<void> {
    if (await processApi.exists(SERVER_PROC_ID)) await processApi.write(SERVER_PROC_ID, "save-on\n");
    await fileApi.delete(PAUSED_MARKER, PANEL_ID);
}

/** at service start: a pause the last service left behind is ended */
export async function recoverPausedSaving(): Promise<boolean> {
    if (!(await fileApi.exists(PAUSED_MARKER, PANEL_ID))) return false;
    await resumeSaving();
    return true;
}
