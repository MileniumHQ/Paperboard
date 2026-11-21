import type { AppUpdateState } from "../../../src/shared/appUpdate";
import type { IssueReportEntry, IssueReportResult, IssueReportSetup } from "../../../src/shared/shellContract";
import type { UpdateQueueState } from "../../../src/shared/updateQueue";

// the shell host (host.main.ts) starts each answer line with this; the
// daemon client it runs logs to stdout too
export const ANSWER = "@@shell-host ";

export interface IssueReportTestState {
    activeReportId: string | null;
    stopped: string[];
    steered: { reportId: string; text: string }[];
    filed: string[];
    openedLinks: { reportId: string; index: number }[];
}

/** the commands the host runs, each with what it answers; shell.host() takes only these */
export interface HostCommands {
    "sign-in-url": { command: { cmd: "sign-in-url" }; result: string };
    "push-update-queue": { command: { cmd: "push-update-queue"; state: UpdateQueueState }; result: true };
    "push-app-update": { command: { cmd: "push-app-update"; state: AppUpdateState }; result: true };
    /** resolves with how many Google sign-ins opened a browser, once at least `atLeast` have */
    "google-sign-ins": { command: { cmd: "google-sign-ins"; atLeast: number }; result: number };
    /** sets what issue-report-setup answers for subsequent opens */
    "issue-report-configure": { command: { cmd: "issue-report-configure"; setup: IssueReportSetup }; result: true };
    /** waits until a report run has started and returns its reportId */
    "issue-report-wait-start": { command: { cmd: "issue-report-wait-start" }; result: string };
    /** pushes a streamed transcript entry to the shell */
    "issue-report-push": { command: { cmd: "issue-report-push"; entry: IssueReportEntry }; result: true };
    /** settles the active issue-report-start call with `result` */
    "issue-report-finish": { command: { cmd: "issue-report-finish"; result: IssueReportResult }; result: true };
    /** snapshot of recorded report calls */
    "issue-report-state": { command: { cmd: "issue-report-state" }; result: IssueReportTestState };
}

export type Command = HostCommands[keyof HostCommands]["command"];
export type CommandResult<C extends Command> = HostCommands[C["cmd"]]["result"];
