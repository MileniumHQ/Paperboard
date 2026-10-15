// How a saved command's last run reads, in the panel and on Home. Pure, so
// the wording is tested once: only an observed exit says "Exited", only exit
// code 0 is shown as success, and a timeout never passes as an exit code.
import type { CommandRun } from "./savedCommands";

export type RunTone = "idle" | "running" | "success" | "danger" | "warning";

export interface RunStatus {
    /** One line: "Exit 0 · 2m ago". */
    text: string;
    /** The outcome alone, for a widget's stat: "Exit 0". */
    value: string;
    /** When it happened, or why it failed: "2m ago". */
    caption: string;
    tone: RunTone;
    /** Longer form for a tooltip / accessible label. */
    detail: string;
}

export function formatAgo(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function describeRun(run: CommandRun | undefined, now: number): RunStatus {
    if (!run) return { text: "Not run yet", value: "Not run yet", caption: "Press Run to start it", tone: "idle", detail: "This command has not run yet" };
    switch (run.state) {
        case "running":
            return { text: "Running…", value: "Running…", caption: `started ${formatAgo(now - run.startedAt)}`, tone: "running", detail: `Started ${formatAgo(now - run.startedAt)}` };
        case "exited": {
            const ago = formatAgo(now - run.endedAt);
            return run.exitCode === 0
                ? { text: `Exit 0 · ${ago}`, value: "Exit 0", caption: ago, tone: "success", detail: `Exited with code 0, ${ago}` }
                : { text: `Exit ${run.exitCode} · ${ago}`, value: `Exit ${run.exitCode}`, caption: ago, tone: "danger", detail: `Exited with code ${run.exitCode}, ${ago}` };
        }
        case "timed-out": {
            const ago = formatAgo(now - run.endedAt);
            return { text: `Timed out · ${ago}`, value: "Timed out", caption: ago, tone: "warning", detail: `Stopped after running too long, ${ago}` };
        }
        case "failed": {
            const ago = formatAgo(now - run.endedAt);
            return { text: `Failed · ${ago}`, value: "Failed", caption: run.error, tone: "danger", detail: run.error };
        }
    }
}

// A press that fails (refused spawn, already running, the cap) never becomes
// a run: the store restores the run the press started from. Its error stands
// until the command's run differs from that one, so an unrelated state push
// cannot erase the failure, while a newer run or the blocking run settling does.
export function runErrorStands(pressedFrom: CommandRun | undefined, current: CommandRun | undefined): boolean {
    if (!pressedFrom || !current) return pressedFrom === current;
    return pressedFrom.startedAt === current.startedAt && pressedFrom.state === current.state;
}
