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
/**
 * The shape each context field takes, so what lands in an agent's
 * instructions (prompt.ts) is never a line a person could word. The worker
 * checks them and the app's tests check its own context against them.
 */
export const CONTEXT_SHAPES: Record<Exclude<keyof IssueContext, "shell">, RegExp> = {
    appVersion: /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/,
    os: /^(?:macOS|Windows|Linux)$/,
    // kernel and OS versions: 15.1, 10.0.26100, 6.12.57+deb13-amd64, 6.12.47+rpt-rpi-v8
    osVersion: /^[0-9A-Za-z._+-]+$/,
    // Node's process.arch names
    arch: /^(?:arm|arm64|ia32|loong64|mips|mipsel|ppc|ppc64|riscv64|s390|s390x|x64)$/,
};
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

/** How many issues one page of the dashboard's list holds. */
export const LIST_PAGE = 100;

/** An issue as the dashboard lists it: the full text and diagnostics load when it's picked. */
export interface IssueSummary {
    id: string;
    /** Unix milliseconds */
    receivedAt: number;
    /** the first line of the text, cut at 200 characters */
    title: string;
    context: IssueContext;
    hasDetails: boolean;
}
