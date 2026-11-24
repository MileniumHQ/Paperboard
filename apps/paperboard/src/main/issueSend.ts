// Report an Issue: what the person typed goes to Paperboard's issues service
// (services/issues), with the app's version and the system it runs on.
// Nothing else about the person or the computer is sent. Kept free of
// Electron imports so it's tested against a local server.
import { ISSUES_ORIGIN, MAX_TEXT_LENGTH, SUBMIT_PATH, type IssueContext, type IssueError } from "issues/shared";

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: "macOS", win32: "Windows", linux: "Linux" };
const TIMEOUT_MS = 15_000;

/** What the app says about itself, from the values Electron gives main. */
export function issueContext(shell: IssueContext["shell"], appVersion: string, systemVersion: string): IssueContext {
    const os = OS_NAMES[process.platform];
    if (!os) throw new Error(`Report an Issue doesn't know the operating system ${process.platform}.`);
    return { appVersion, os, osVersion: systemVersion, arch: process.arch, shell };
}

export async function sendIssue(text: string, context: IssueContext, origin: string = ISSUES_ORIGIN): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Say what went wrong first.");
    if (trimmed.length > MAX_TEXT_LENGTH) throw new Error(`An issue holds at most ${MAX_TEXT_LENGTH.toLocaleString("en")} characters.`);
    let res: Response;
    try {
        res = await fetch(new URL(SUBMIT_PATH, origin), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: trimmed, context }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch (err) {
        throw new Error(`Couldn't reach Paperboard's issues service: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (res.ok) return;
    // quiet: a body that isn't the service's JSON error still fails below, with its status
    const body = (await res.json().catch(() => null)) as IssueError | null;
    throw new Error(body?.error?.message ?? `Paperboard's issues service answered HTTP ${res.status}.`);
}
