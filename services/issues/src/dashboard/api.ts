// The dashboard's calls, same-origin under /dashboard/api, where the worker
// checks the Access sign-in the browser carries.
import type { Issue, IssueError } from "../shared";

const API = "/dashboard/api/issues";

async function failure(res: Response): Promise<Error> {
    // quiet: a body that isn't the service's JSON error still fails, with its status
    const body = (await res.json().catch(() => null)) as IssueError | null;
    return new Error(body?.error?.message ?? `The dashboard answered HTTP ${res.status}.`);
}

export async function listIssues(): Promise<Issue[]> {
    const res = await fetch(API);
    if (!res.ok) throw await failure(res);
    return ((await res.json()) as { issues: Issue[] }).issues;
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
