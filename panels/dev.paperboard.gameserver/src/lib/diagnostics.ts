import { createStateSignal } from "@mileniumhq/paperui/headless";
import { serverPort } from "./server";
import { checkLogForIssues as coreCheckLogForIssues } from "../core/diagnostics";
import type { ServerIssue, ServerIssueAction } from "../core/diagnostics";
import { serverCalls } from "./api";

export type { ServerIssue, ServerIssueAction };
export { coreCheckLogForIssues as checkLogForIssues };

export const [activeIssue, setActiveIssue] = createStateSignal<ServerIssue | null>(null);

/** Rejects when the service kept the issue; the modal showing it says why. */
export function clearActiveIssue(): Promise<unknown> {
    return serverCalls.clearActiveIssue();
}

/** Rejects with why the service could not end what holds the port. */
export async function killConflictingProcess(port: string = serverPort()): Promise<void> {
    await serverCalls.killConflictingProcess({ port });
}
