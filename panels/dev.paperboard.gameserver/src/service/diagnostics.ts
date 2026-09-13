import {
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import type { GameServerState } from "./types";
import {
    checkLogForIssues as coreCheckLogForIssues,
    detectServerIssue,
    assertPort,
    killConflictingProcessWith,
    resetWorldFilesWith,
} from "../core/diagnostics";
import { makeTrashRemoveDeps } from "./trashDeps";
import { resolveLevelName } from "./worlds";

export { detectServerIssue };

// kill + reset both ride the trash transport factory (one implementation
// for every pty-backed destructive/repair path)
const makeDiagnosticsDeps = () => makeTrashRemoveDeps("Service:Diagnostics");

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
        await killConflictingProcessWith(makeDiagnosticsDeps(), targetPort);
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
    // the reset follows the server's actual level-name, read fresh — a
    // renamed world must reset the renamed dirs, not hardcoded "world*"
    const levelName = await resolveLevelName();
    try {
        await resetWorldFilesWith(makeDiagnosticsDeps(), levelName);
        return true;
    } catch (err) {
        // honest result: the UI must not believe "world directories were
        // removed" when the remove failed or never completed
        console.error(`[Service:Diagnostics] Failed to reset world files:`, err);
        return false;
    }
}
