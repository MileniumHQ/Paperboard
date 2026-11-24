// The dashboard's calls, same-origin under /dashboard/api, where the worker
// checks the Access sign-in the browser carries.
import type { Issue, IssueError, IssueSummary } from "../shared";

const API = "/dashboard/api/issues";

async function failure(res: Response): Promise<Error> {
    // quiet: a body that isn't the service's JSON error still fails, with its status
    const body = (await res.json().catch(() => null)) as IssueError | null;
    return new Error(body?.error?.message ?? `The dashboard answered HTTP ${res.status}.`);
}

export interface IssuePage {
    issues: IssueSummary[];
    /** older issues are still on the service */
    more: boolean;
}

/** One page of summaries, newest first: the ones after the issue (`before` in Unix milliseconds, `beforeId`), or the newest. */
export async function listIssues(before?: number, beforeId?: string): Promise<IssuePage> {
    const res = await fetch(before === undefined ? API : `${API}?before=${before}&beforeId=${beforeId}`);
    if (!res.ok) throw await failure(res);
    return (await res.json()) as IssuePage;
}

/** One issue in full: its text and diagnostics. */
export async function getIssue(id: string): Promise<Issue> {
    const res = await fetch(`${API}/${id}`);
    if (!res.ok) throw await failure(res);
    return ((await res.json()) as { issue: Issue }).issue;
}

export async function deleteIssue(id: string): Promise<void> {
    const res = await fetch(`${API}/${id}`, { method: "DELETE" });
    if (!res.ok) throw await failure(res);
}

/** the issue as a prompt file, for a coding agent to open an issue and a pull request */
export function downloadPrompt(id: string): void {
    const link = document.createElement("a");
    link.href = `${API}/${id}/prompt`;
    link.download = "";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}
