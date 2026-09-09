import { createSignal } from "solid-js";
import { serverPort, serverBridge } from "./server";
import { checkLogForIssues as coreCheckLogForIssues } from "../core/diagnostics";
import type { ServerIssue, ServerIssueAction } from "../core/diagnostics";

export type { ServerIssue, ServerIssueAction };
export { coreCheckLogForIssues as checkLogForIssues };

export const [activeIssue, setActiveIssue] = createSignal<ServerIssue | null>(null);

export function clearActiveIssue() {
    setActiveIssue(null);
    serverBridge.actions.clearActiveIssue().catch(() => {});
}

export async function killConflictingProcess(port: string = serverPort()) {
    await serverBridge.actions.killConflictingProcess(port);
}

export async function resetWorldFiles() {
    await serverBridge.actions.resetWorldFiles();
}
