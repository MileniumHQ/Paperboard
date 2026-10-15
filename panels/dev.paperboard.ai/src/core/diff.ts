// An agent's edit, shown as lines removed and added. Not a minimal diff: the
// unchanged lines at both ends are trimmed and the middle is shown as one
// replaced block, which is linear in the text and reads right for the
// focused edits agents make.

export type DiffLine = { kind: "context" | "removed" | "added"; text: string };

/** unchanged lines kept around the change */
export const DIFF_CONTEXT_LINES = 3;
/** lines shown per side; the rest is summarised */
export const MAX_DIFF_LINES = 400;

export interface EditView {
    lines: DiffLine[];
    /** lines of the replaced block not shown */
    hidden: number;
}

export function editLines(oldText: string | null, newText: string): EditView {
    const before = oldText === null ? [] : oldText.split("\n");
    const after = newText.split("\n");
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const removed = before.slice(head, before.length - tail);
    const added = after.slice(head, after.length - tail);
    const keep = (list: string[]) => list.slice(0, MAX_DIFF_LINES);
    const lines: DiffLine[] = [
        ...before.slice(Math.max(0, head - DIFF_CONTEXT_LINES), head).map((text) => ({ kind: "context" as const, text })),
        ...keep(removed).map((text) => ({ kind: "removed" as const, text })),
        ...keep(added).map((text) => ({ kind: "added" as const, text })),
        ...before.slice(before.length - tail, before.length - tail + DIFF_CONTEXT_LINES).map((text) => ({ kind: "context" as const, text })),
    ];
    return { lines, hidden: Math.max(0, removed.length - MAX_DIFF_LINES) + Math.max(0, added.length - MAX_DIFF_LINES) };
}
