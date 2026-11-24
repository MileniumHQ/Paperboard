// What the app sends and the dashboard reads. The app imports this file
// (as "issues/shared"), so the form and the worker hold the same limits.

/** Where the service runs. */
export const ISSUES_ORIGIN = "https://issues.ariapis.com";
/** The path the app posts an issue to. */
export const SUBMIT_PATH = "/v1/issues";

/** The longest issue text, in UTF-16 code units, after trimming. */
export const MAX_TEXT_LENGTH = 10_000;
/** The longest diagnostics text (logs, panels), in UTF-16 code units. */
export const MAX_DETAILS_LENGTH = 60_000;
/** The longest context value, in UTF-16 code units. */
export const MAX_CONTEXT_LENGTH = 100;
/** The largest request body the submit endpoint reads, in bytes. */
export const MAX_BODY_BYTES = 256 * 1024;

/** What the app says about itself alongside the issue. Nothing about the person or the computer's name. */
export interface IssueContext {
    /** Paperboard's version, like 0.4.0 */
    appVersion: string;
    /** "macOS", "Windows" or "Linux" */
    os: string;
    /** the operating system's own version */
    osVersion: string;
    /** the CPU architecture, like arm64 or x64 */
    arch: string;
    /** where Paperboard was shown: its own window, or a browser tab */
    shell: "window" | "browser";
}

export const CONTEXT_KEYS = ["appVersion", "os", "osVersion", "arch", "shell"] as const satisfies readonly (keyof IssueContext)[];
export const SHELLS = ["window", "browser"] as const satisfies readonly IssueContext["shell"][];

export interface IssueSubmission {
    text: string;
    context: IssueContext;
    /**
     * What the app attached to help find the cause, when the person left it
     * on: the computer, its panels and versions, and recent log lines, with
     * paths, names, addresses and secrets scrubbed. Empty when left off.
     */
    details: string;
}

export interface Issue extends IssueSubmission {
    id: string;
    /** Unix milliseconds */
    receivedAt: number;
}

/** Every error the service answers with. */
export interface IssueError {
    error: { code: string; message: string };
}
