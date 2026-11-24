import { minecraftOf } from "./state";
import type { Server } from "../../service/server";
import { errorMessage } from "../../service/api";
import { PANEL_ID, SERVER_PROC_ID } from "../../service/types";

// Copying a running world: the server writes region files whenever it
// autosaves, so a copy taken meanwhile can catch half a write. Saving is
// switched off (save-off), everything in memory is written out
// (save-all flush), the copy is made, and saving is switched back on.
// A marker file records the pause, so a service that died mid-copy turns
// saving back on when it starts and finds the server still running. The
// marker is removed only once the server has confirmed save-on: a write the
// daemon could not deliver, or one the server never answered, leaves the
// marker for the next recovery. A backup pauses saving in its beforeBackup
// and turns it back on in its afterBackup; a service that dies between them
// ends the pause when it starts again.

/** a server folder's record of a pause; backups leave it out */
export const PAUSED_MARKER = ".paperboard-saving-paused";
const FLUSH_TIMEOUT_MS = 120_000;
const COMMAND_TIMEOUT_MS = 15_000;

export type Waiter = { match: (line: string) => boolean; resolve: (line: string) => void };
// at most one pause at a time, so at most two waiters (off, flushed)

/** every console line passes here (lifecycle.handleProcessData) */
export function observeSavingLine(ctx: Server, line: string): void {
    for (const waiter of minecraftOf(ctx).saving.waiters) {
        if (waiter.match(line)) {
            minecraftOf(ctx).saving.waiters.delete(waiter);
            waiter.resolve(line);
        }
    }
}

/** the next console line `match` accepts, or a failure naming `what` once `timeoutMs` passes without one */
export function waitForLine(ctx: Server, match: (line: string) => boolean, timeoutMs: number, what: string): { done: Promise<string>; cancel: () => void } {
    let waiter!: Waiter;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<string>((resolve, reject) => {
        waiter = { match, resolve: (line) => { clearTimeout(timer); resolve(line); } };
        timer = setTimeout(() => {
            minecraftOf(ctx).saving.waiters.delete(waiter);
            reject(new Error(`The server did not confirm ${what} within ${Math.round(timeoutMs / 1000)} seconds`));
        }, timeoutMs);
        minecraftOf(ctx).saving.waiters.add(waiter);
    });
    return { done, cancel: () => { clearTimeout(timer); minecraftOf(ctx).saving.waiters.delete(waiter); } };
}

// "Automatic saving is now disabled", "Saving is already turned off"
const savingOff = (line: string) => /saving is (now disabled|already turned off)/i.test(line);
// "Automatic saving is now enabled", "Saving is already turned on"
const savingOn = (line: string) => /saving is (now enabled|already turned on)/i.test(line);
// "Saved the game", "Saved the world"
const flushed = (line: string) => /Saved the (game|world)/i.test(line);

/** writes a console command and resolves once the server prints a line `confirm` accepts */
export async function send(ctx: Server, command: string, confirm: (line: string) => boolean, timeoutMs: number, what: string): Promise<void> {
    const wait = waitForLine(ctx, confirm, timeoutMs, what);
    try {
        await ctx.process.write(SERVER_PROC_ID, `${command}\n`);
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
export async function withSavingPaused<T>(ctx: Server, work: () => Promise<T>): Promise<T> {
    if (ctx.state.serverStatus === "offline") return work();
    if (ctx.state.serverStatus !== "online") throw new Error("Wait until the server has finished starting or stopping");
    if (minecraftOf(ctx).saving.pausing) throw new Error("Saving is already paused for another copy");
    minecraftOf(ctx).saving.pausing = true;
    try {
        let result!: T;
        let workError: unknown;
        let workFailed = false;
        try {
            await pauseSaving(ctx);
            result = await work();
        } catch (err) {
            workFailed = true;
            workError = err;
        }
        try {
            await resumeSaving(ctx);
        } catch (err) {
            // saving is still off and the marker stays: say so, and keep
            // the failure that came first
            const reason = errorMessage(err);
            const earlier = workFailed ? ` (the copy also failed: ${errorMessage(workError)})` : "";
            throw new Error(`Saving could not be turned back on: ${reason}${earlier}`, { cause: err });
        }
        if (workFailed) throw workError;
        return result;
    } finally {
        minecraftOf(ctx).saving.pausing = false;
    }
}

/** Save: everything in memory is written out, confirmed by the server's "Saved the game". */
export async function saveWorld(ctx: Server): Promise<void> {
    if (ctx.state.serverStatus !== "online") throw new Error("Start the server before saving");
    await send(ctx, "save-all flush", flushed, FLUSH_TIMEOUT_MS, "that the world is saved");
}

/** the marker first, so a pause is never left without one */
async function pauseSaving(ctx: Server): Promise<void> {
    await ctx.files.write(PAUSED_MARKER, new Date().toISOString(), PANEL_ID);
    await send(ctx, "save-off", savingOff, COMMAND_TIMEOUT_MS, "that saving is paused");
    await send(ctx, "save-all flush", flushed, FLUSH_TIMEOUT_MS, "that the world is saved");
}

/**
 * A backup's preparation: a running server writes its world out and stops
 * saving. Saving stays off while Paperboard copies the server folder, and
 * the backup's end turns it back on (recoverPausedSaving), as a service
 * that starts after dying meanwhile does. When the server cannot pause,
 * saving is turned back on and the backup refused.
 */
export async function pauseSavingForBackup(ctx: Server): Promise<void> {
    if (ctx.state.serverStatus === "offline") return;
    if (ctx.state.serverStatus !== "online") throw new Error("The server is starting or stopping; back it up when it has finished");
    if (minecraftOf(ctx).saving.pausing) throw new Error("A world download is copying the world; back up when it has finished");
    minecraftOf(ctx).saving.pausing = true;
    try {
        await pauseSaving(ctx);
    } catch (err) {
        try {
            await resumeSaving(ctx);
        } catch (resumeErr) {
            const reason = errorMessage(resumeErr);
            throw new Error(`${errorMessage(err)} (saving could not be turned back on: ${reason})`, { cause: err });
        }
        throw err;
    } finally {
        minecraftOf(ctx).saving.pausing = false;
    }
}

/** the marker goes only after the server confirmed save-on */
async function resumeSaving(ctx: Server): Promise<void> {
    if (await ctx.process.exists(SERVER_PROC_ID)) {
        await send(ctx, "save-on", savingOn, COMMAND_TIMEOUT_MS, "that saving is back on");
    }
    await ctx.files.delete(PAUSED_MARKER, PANEL_ID);
}

/** after a backup's copy, and at service start: a pause still standing is ended */
export async function recoverPausedSaving(ctx: Server): Promise<boolean> {
    if (!(await ctx.files.exists(PAUSED_MARKER, PANEL_ID))) return false;
    await resumeSaving(ctx);
    return true;
}
