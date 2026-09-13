import { createSignal } from "solid-js";
import { serverPort, serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import { checkLogForIssues as coreCheckLogForIssues } from "../core/diagnostics";
import type { ServerIssue, ServerIssueAction } from "../core/diagnostics";

export type { ServerIssue, ServerIssueAction };
export { coreCheckLogForIssues as checkLogForIssues };

export const [activeIssue, setActiveIssue] = createSignal<ServerIssue | null>(null);

export function clearActiveIssue() {
    serverBridge.call(ACTION_IDS.clearActiveIssue).catch((err) =>
        console.debug("[diagnostics] clearActiveIssue failed:", String(err)),
    );
}

export async function killConflictingProcess(port: string = serverPort()): Promise<boolean> {
    // the boolean is the service's verified outcome, not a convenience flag
    const res = await serverBridge.call<boolean>(ACTION_IDS.killConflictingProcess, { port });
    return res !== false;
}

export async function resetWorldFiles(): Promise<boolean> {
    const res = await serverBridge.call<boolean>(ACTION_IDS.resetWorldFiles);
    return res !== false;
}
