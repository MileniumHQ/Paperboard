import type { PaperConsoleEntry } from "@mileniumhq/paperui";
import type { IssueReportEntry, IssueReportResult, IssueReportSetup } from "../../../../shared/shellContract";

export type WrittenReport = Extract<IssueReportResult, { status: "written" }>;
export type ReportLink = IssueReportSetup["links"][number];

export const GITHUB_DESTINATION = "github";
const LINK_PREFIX = "link:";

export const linkValue = (index: number): string => `${LINK_PREFIX}${index}`;

export function linkIndex(value: string | null): number | null {
    if (!value?.startsWith(LINK_PREFIX)) return null;
    const index = Number(value.slice(LINK_PREFIX.length));
    return Number.isInteger(index) && index >= 0 ? index : null;
}

/** GitHub when the CLI can file it, else the config's first link, else nothing. */
export function defaultDestination(issue: WrittenReport, links: readonly ReportLink[]): string | null {
    if (issue.github?.state === "signed-in") return GITHUB_DESTINATION;
    return links.length > 0 ? linkValue(0) : null;
}

/** A link's description in the destination list, noting when Paperboard copies the issue first. */
export function linkDescription(link: ReportLink): string | undefined {
    if (link.includesIssue) return link.description;
    return link.description ? `${link.description} Copies the issue to your clipboard first.` : "Copies the issue to your clipboard first.";
}

/** Joins agent names as natural English prose ("Claude Code, Codex, or Cursor"). */
export function joinOr(names: readonly string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    if (names.length === 2) return `${names[0]} or ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

// a failed tool is an error; a refused one is a warning; the person's own words are commands;
// tool lines stay plain, so a path is never read as Markdown
export function consoleEntry(entry: IssueReportEntry): PaperConsoleEntry {
    switch (entry.kind) {
        case "steer":
            return { id: entry.id, type: "command", content: entry.text };
        case "blocked":
            return { id: entry.id, type: "warn", content: `Refused: ${entry.text}` };
        case "notice":
            return { id: entry.id, type: "info", content: entry.text };
        case "tool":
            return { id: entry.id, type: entry.status === "failed" ? "error" : "info", content: entry.text };
        default:
            // the agent's thinking and replies are Markdown
            return { id: entry.id, type: "output", content: entry.text, markdown: true };
    }
}

/**
 * Applies one streamed entry to the console list: untouched rows keep their
 * exact object reference so PaperConsole never rebuilds them, and a push that
 * changes nothing returns the same array reference.
 */
export function upsertConsoleEntry(list: readonly PaperConsoleEntry[], incoming: IssueReportEntry): PaperConsoleEntry[] {
    const next = consoleEntry(incoming);
    const at = list.findIndex((line) => line.id === incoming.id);
    if (at === -1) return [...list, next];
    const prev = list[at];
    if (prev.type === next.type && prev.content === next.content && prev.markdown === next.markdown) {
        return list as PaperConsoleEntry[];
    }
    const updated = list.slice();
    updated[at] = next;
    return updated;
}
