import {
    files as fileApi,
    system,
    terminal as terminalApi,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import type { GameServerState } from "./types";
import { PANEL_ID } from "./types";
import {
    checkLogForIssues as coreCheckLogForIssues,
    detectServerIssue,
    killConflictingProcessWith,
    resetWorldFilesWith,
} from "../core/diagnostics";

export { detectServerIssue };

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
): Promise<void> {
    const targetPort = port || ctx.state.serverPort;
    try {
        await killConflictingProcessWith(
            {
                createPty: (id, opts) => terminalApi.create(id, opts),
                writePty: (id, data) => terminalApi.write(id, data),
                scheduleDestroy: (id) => {
                    setTimeout(() => terminalApi.destroy(id), 1000);
                },
            },
            targetPort,
        );
    } catch (err) {
        console.error(`[Service:Diagnostics] Failed to kill process on port ${targetPort}:`, err);
    }
}

export async function resetWorldFiles(): Promise<void> {
    try {
        await resetWorldFilesWith({
            createPty: (id, opts) => terminalApi.create(id, opts),
            writePty: (id, data) => terminalApi.write(id, data),
            scheduleDestroy: (id) => {
                setTimeout(() => terminalApi.destroy(id), 1000);
            },
            getServerDir: () => fileApi.getPath("", PANEL_ID),
            getTargetOs: async () => (await system.getInfo()).os,
        });
    } catch (err) {
        console.error("[Service:Diagnostics] Failed to reset world files:", err);
    }
}
