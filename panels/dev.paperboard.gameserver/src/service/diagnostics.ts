import {
    files as fileApi,
    processApi,
    system,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { type GameServerState, PANEL_ID } from "./types";
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

const killPortDeps: KillPortDeps = {
    isWindows: async () =>
        isWindowsTarget(await fileApi.getPath("", PANEL_ID), (await system.getInfo()).os),
    run: async (command, args, onStdout) =>
        (await processApi.run({ command, args, onStdout })).exitCode,
    // this service runs on the server's computer, so the pid is local
    kill: (pid) => process.kill(pid, "SIGKILL"),
    ownPid: process.pid,
};

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
    ctx: ServiceContext<GameServerState>,
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

export function clearActiveIssue(ctx: ServiceContext<GameServerState>): void {
    ctx.setState({ activeIssue: null });
}

export async function killConflictingProcess(
    ctx: ServiceContext<GameServerState>,
    port?: string,
): Promise<boolean> {
    // boundary: the port arrives from UI action input — validated here, and
    // again inside killConflictingProcessWith as the last line of defense
    const targetPort = assertPort(port || ctx.state.serverPort, "port");
    try {
        const killed = await killConflictingProcessWith(killPortDeps, targetPort);
        console.log(`[Service:Diagnostics] killed ${killed} process(es) listening on port ${targetPort}`);
        return true;
    } catch (err) {
        // loud, and the RESULT is honest: the action must not report a
        // kill that did not happen
        console.error(`[Service:Diagnostics] Failed to kill process on port ${targetPort}:`, err);
        return false;
    }
}

export async function resetWorldFiles(
    ctx: ServiceContext<GameServerState>,
): Promise<boolean> {
    // reset deletes live world dirs: same offline rule as the world manager
    assertServerOffline(ctx);
    // the reset follows the server's actual level-name, read fresh — a
    // renamed world must reset the renamed dirs, not hardcoded "world*"
    const levelName = await resolveLevelName();
    try {
        await trashRemovePathsWith(makeTrashRemoveDeps(), getWorldDirsToDelete(levelName));
        return true;
    } catch (err) {
        // honest result: the UI must not believe "world directories were
        // removed" when the remove failed or never completed
        console.error(`[Service:Diagnostics] Failed to reset world files:`, err);
        return false;
    }
}
