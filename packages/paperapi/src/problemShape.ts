// What a panel's problem is, and the limits on it: one shape for the SDK
// that reports it and the daemon that keeps it. Plain TypeScript.

/** A failure no button was waiting for, kept until it is fixed or dismissed. */
export interface PanelProblem {
    /** what it is about: a report with the same key replaces it, and clearing the key takes it away */
    key: string;
    /** what failed, as a short sentence: "The world couldn't be saved" */
    title: string;
    /** why, in the failure's own words */
    message: string;
    /** when it was last reported, in ms since the epoch */
    at: number;
}

/** The problem a panel reports; without a key it is a new problem every time. */
export interface ProblemReport {
    title: string;
    message: string;
    key?: string;
}

/** the problems a panel keeps; one more drops the one reported longest ago */
export const PROBLEMS_PER_PANEL = 20;
export const PROBLEM_KEY_MAX = 200;
export const PROBLEM_TITLE_MAX = 200;
export const PROBLEM_MESSAGE_MAX = 2000;
/** a panel's problems changed: `{ panelId, problems }`, the panel's whole list */
export const PROBLEMS_EVENT = "problems:changed";

function text(value: unknown, name: string, max: number): string {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`A problem needs a ${name}: some text`);
    if (value.length > max) throw new Error(`A problem's ${name} is at most ${max} characters, not ${value.length}`);
    return value;
}

/** A problem key, or why it can't be one. */
export function problemKey(value: unknown): string {
    return text(value, "key", PROBLEM_KEY_MAX);
}

const clip = (value: unknown, max: number) => (typeof value === "string" && value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** The report with a title or message too long for the daemon cut to fit, ending in "…": an error's own words can run long. */
export function clipProblemReport(report: ProblemReport): ProblemReport {
    return { ...report, title: clip(report?.title, PROBLEM_TITLE_MAX) as string, message: clip(report?.message, PROBLEM_MESSAGE_MAX) as string };
}

/** The report, checked, or why it can't be one. */
export function readProblemReport(value: unknown): Required<Pick<ProblemReport, "title" | "message">> & { key?: string } {
    const report = (value ?? {}) as Record<string, unknown>;
    return {
        title: text(report.title, "title", PROBLEM_TITLE_MAX),
        message: text(report.message, "message", PROBLEM_MESSAGE_MAX),
        ...(report.key === undefined ? {} : { key: problemKey(report.key) }),
    };
}
