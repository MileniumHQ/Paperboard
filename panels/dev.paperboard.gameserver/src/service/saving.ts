import { files as fileApi, processApi, type ServiceContext } from "@mileniumhq/paperapi";
import { PANEL_ID, SERVER_PROC_ID, type GameServerState } from "./types";

// Copying a running world: the server writes region files whenever it
// autosaves, so a copy taken meanwhile can catch half a write. Saving is
// switched off (save-off), everything in memory is written out
// (save-all flush), the copy is made, and saving is switched back on.
// A marker file records the pause, so a service that died mid-copy turns
// saving back on when it starts and finds the server still running. The
// marker is removed only once the server has confirmed save-on: a write the
// daemon could not deliver, or one the server never answered, leaves the
// marker for the next recovery. A
// backup of the whole server uses that on purpose: Paperboard stops this
// service for the copy, and the service that starts after it ends the pause.

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
// "Automatic saving is now enabled", "Saving is already turned on"
const savingOn = (line: string) => /saving is (now enabled|already turned on)/i.test(line);
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
        let result!: T;
        let workError: unknown;
        let workFailed = false;
        try {
            await pauseSaving();
            result = await work();
        } catch (err) {
            workFailed = true;
            workError = err;
        }
        try {
            await resumeSaving();
        } catch (err) {
            // saving is still off and the marker stays: say so, and keep
            // the failure that came first
            const reason = err instanceof Error ? err.message : String(err);
            const earlier = workFailed ? ` (the copy also failed: ${workError instanceof Error ? workError.message : String(workError)})` : "";
            throw new Error(`Saving could not be turned back on: ${reason}${earlier}`, { cause: err });
        }
        if (workFailed) throw workError;
        return result;
    } finally {
        pausing = false;
    }
}

/** the marker first, so a pause is never left without one */
async function pauseSaving(): Promise<void> {
    await fileApi.write(PAUSED_MARKER, new Date().toISOString(), PANEL_ID);
    await send("save-off", savingOff, COMMAND_TIMEOUT_MS, "that saving is paused");
    await send("save-all flush", flushed, FLUSH_TIMEOUT_MS, "that the world is saved");
}

/**
 * The service's beforeBackup: a running server writes its world out and
 * stops saving. Saving stays off while Paperboard stops this service and
 * copies the server folder; the service that starts after the copy finds
 * the marker and turns saving back on (recoverPausedSaving). When the
 * server cannot pause, saving is turned back on and the backup refused.
 */
export async function pauseSavingForBackup(ctx: ServiceContext<GameServerState>): Promise<void> {
    if (ctx.state.serverStatus === "offline") return;
    if (ctx.state.serverStatus !== "online") throw new Error("The server is starting or stopping; back it up when it has finished");
    if (pausing) throw new Error("A world download is copying the world; back up when it has finished");
    pausing = true;
    try {
        await pauseSaving();
    } catch (err) {
        try {
            await resumeSaving();
        } catch (resumeErr) {
            const reason = resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
            throw new Error(`${err instanceof Error ? err.message : String(err)} (saving could not be turned back on: ${reason})`, { cause: err });
        }
        throw err;
    } finally {
        pausing = false;
    }
}

/** the marker goes only after the server confirmed save-on */
async function resumeSaving(): Promise<void> {
    if (await processApi.exists(SERVER_PROC_ID)) {
        await send("save-on", savingOn, COMMAND_TIMEOUT_MS, "that saving is back on");
    }
    await fileApi.delete(PAUSED_MARKER, PANEL_ID);
}

/** at service start: a pause the last service left behind is ended */
export async function recoverPausedSaving(): Promise<boolean> {
    if (!(await fileApi.exists(PAUSED_MARKER, PANEL_ID))) return false;
    await resumeSaving();
    return true;
}
