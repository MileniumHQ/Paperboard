import { createStateSignal } from "@mileniumhq/paperui/headless";
import { serverPort, serverBridge } from "./server";
import { CALLS } from "../service/contract";
import { checkLogForIssues as coreCheckLogForIssues } from "../core/diagnostics";
import type { ServerIssue, ServerIssueAction } from "../core/diagnostics";

export type { ServerIssue, ServerIssueAction };
export { coreCheckLogForIssues as checkLogForIssues };

export const [activeIssue, setActiveIssue] = createStateSignal<ServerIssue | null>(null);

/** Rejects when the service kept the issue; the modal showing it says why. */
export function clearActiveIssue(): Promise<unknown> {
    return serverBridge.call(CALLS.clearActiveIssue);
}

/** Rejects with why the service could not end what holds the port. */
export async function killConflictingProcess(port: string = serverPort()): Promise<void> {
    await serverBridge.call(CALLS.killConflictingProcess, { port });
}
