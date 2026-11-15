import type { Server } from "./server";
import { system } from "./api";
import {
    checkLogForIssues as coreCheckLogForIssues,
    detectServerIssue,
    assertPort,
    listeningPidsCommand,
    parseListeningPids,
} from "../core/diagnostics";
import { getWorldDirsToDelete } from "../core/worlds";
import { isWindowsTarget } from "../lib/platform";
import { makeTrashRemoveDeps } from "./trashDeps";
import { trashRemovePathsWith } from "./trash";
import { resolveLevelName, assertServerOffline } from "./worlds";

export { detectServerIssue };

export interface KillPortDeps {
    isWindows: () => Promise<boolean>;
    run: (command: string, args: string[], onStdout: (chunk: string) => void) => Promise<number>;
    kill: (pid: number) => void;
    ownPid: number;
}

const killPortDeps = (ctx: Server): KillPortDeps => ({
    isWindows: async () =>
        isWindowsTarget(await ctx.root(), (await system.getInfo()).os),
    run: async (command, args, onStdout) =>
        (await ctx.process.run({ command, args, onStdout })).exitCode,
    // this service runs on the server's computer, so the pid is local
    kill: (pid) => process.kill(pid, "SIGKILL"),
    ownPid: process.pid,
});

// Kills whatever listens on the port and returns how many processes it
// killed. Finding none is a valid answer (0); being unable to look is a
// failure. lsof exits 1 when nothing matches, so only output decides.
export async function killConflictingProcessWith(
    deps: KillPortDeps,
    port: unknown,
): Promise<number> {
    // last line of defense: even a caller that forgot to validate cannot
    // put anything but digits into the lookup
    const safePort = assertPort(port);
    const isWin = await deps.isWindows();
    const { command, args } = listeningPidsCommand(safePort, isWin);
    let output = "";
    const exitCode = await deps.run(command, args, (chunk) => {
        output += chunk;
    });
    const pids = parseListeningPids(output).filter((pid) => pid !== deps.ownPid);
    if (exitCode !== 0 && !(exitCode === 1 && !isWin && pids.length === 0)) {
        throw new Error(`Could not look up the process on port ${safePort} (${command} exited ${exitCode})`);
    }
    for (const pid of pids) deps.kill(pid);
    return pids.length;
}

export function checkLogForIssues(
    ctx: Server,
    cleanLine: string,
): void {
    coreCheckLogForIssues(
        {
            serverPort: ctx.state.serverPort,
            setIssue: (issue) => ctx.setState({ activeIssue: issue }),
        },
        cleanLine,
    );
}

export function clearActiveIssue(ctx: Server): void {
    ctx.setState({ activeIssue: null });
}

/** Ends what holds the server's port; a kill that failed throws why. */
export async function killConflictingProcess(
    ctx: Server,
    port?: string,
): Promise<void> {
    // boundary: the port arrives from UI action input — validated here, and
    // again inside killConflictingProcessWith as the last line of defense
    const targetPort = assertPort(port || ctx.state.serverPort, "port");
    const killed = await killConflictingProcessWith(killPortDeps(ctx), targetPort);
    console.log(`[Service:Diagnostics] killed ${killed} process(es) listening on port ${targetPort}`);
}

/** Moves the active world's folders to the trash; a move that failed throws why. */
export async function resetWorldFiles(
    ctx: Server,
): Promise<void> {
    // reset deletes live world dirs: same offline rule as the world manager
    assertServerOffline(ctx);
    // the reset follows the server's actual level-name, read fresh — a
    // renamed world must reset the renamed dirs, not hardcoded "world*"
    const levelName = await resolveLevelName(ctx);
    await trashRemovePathsWith(makeTrashRemoveDeps(ctx), getWorldDirsToDelete(levelName));
}
