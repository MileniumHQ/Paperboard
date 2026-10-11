// Pure text edits behind PaperEditor's keys. Each returns the range to
// replace and the selection afterwards, so the component can apply it as one
// native edit (one undo step) instead of rewriting the whole value.

export interface TextEdit {
    /** replace text[from, to) with `insert` */
    from: number;
    to: number;
    insert: string;
    selectionStart: number;
    selectionEnd: number;
}

const SCAN_LINES = 2000;

/**
 * The indent a file already uses: a tab when most indented lines start with
 * one, otherwise the smallest run of leading spaces (2 to 8). A file with no
 * indented lines gets `fallback`.
 */
export function detectIndent(text: string, fallback = "    "): string {
    let tabs = 0;
    let spaced = 0;
    let smallest = 0;
    let start = 0;
    for (let n = 0; n < SCAN_LINES && start <= text.length; n++) {
        const end = text.indexOf("\n", start);
        const line = text.slice(start, end === -1 ? text.length : end);
        if (line.startsWith("\t")) tabs++;
        else {
            const match = /^( +)\S/.exec(line);
            if (match) {
                spaced++;
                const width = match[1]!.length;
                if (width >= 2 && (smallest === 0 || width < smallest)) smallest = width;
            }
        }
        if (end === -1) break;
        start = end + 1;
    }
    if (tabs > spaced) return "\t";
    if (spaced === 0) return fallback;
    return " ".repeat(Math.min(Math.max(smallest || 2, 2), 8));
}

function lineStartOf(text: string, pos: number): number {
    return text.lastIndexOf("\n", pos - 1) + 1;
}

function lineEndOf(text: string, pos: number): number {
    const end = text.indexOf("\n", pos);
    return end === -1 ? text.length : end;
}

/** the whole lines a selection touches; a selection ending at a line's start leaves that line out */
function lineBlock(text: string, start: number, end: number): { from: number; to: number } {
    const from = lineStartOf(text, start);
    const lastPos = end > start && text[end - 1] === "\n" ? end - 1 : end;
    return { from, to: lineEndOf(text, lastPos) };
}

/** how much leading indent one outdent removes from `line` */
function outdentWidth(line: string, unit: string): number {
    if (line.startsWith("\t")) return 1;
    const width = unit === "\t" ? 4 : unit.length;
    let n = 0;
    while (n < width && line[n] === " ") n++;
    return n;
}

/**
 * Tab / Shift+Tab. A collapsed caret with Tab inserts one indent; anything
 * else indents or outdents every line the selection touches (blank lines are
 * left alone when indenting).
 */
export function indentEdit(
    text: string,
    start: number,
    end: number,
    unit: string,
    outdent: boolean,
): TextEdit | null {
    const multiLine = text.slice(start, end).includes("\n");
    if (!outdent && !multiLine) {
        return { from: start, to: end, insert: unit, selectionStart: start + unit.length, selectionEnd: start + unit.length };
    }
    const block = lineBlock(text, start, end);
    const lines = text.slice(block.from, block.to).split("\n");
    let firstDelta = 0;
    const changed = lines.map((line, i) => {
        if (outdent) {
            const width = outdentWidth(line, unit);
            if (i === 0) firstDelta = -width;
            return line.slice(width);
        }
        if (line.trim() === "") return line;
        if (i === 0) firstDelta = unit.length;
        return unit + line;
    });
    const insert = changed.join("\n");
    if (insert === text.slice(block.from, block.to)) return null;
    if (!multiLine) {
        // a caret (or in-line selection) keeps its place in the shifted line
        const shift = (pos: number) => Math.max(block.from, pos + firstDelta);
        return { from: block.from, to: block.to, insert, selectionStart: shift(start), selectionEnd: shift(end) };
    }
    return { from: block.from, to: block.to, insert, selectionStart: block.from, selectionEnd: block.from + insert.length };
}

/**
 * Enter keeps the current line's indent, and opens one more level after a
 * line that ends a block header (`key:` in YAML, or a `{` / `[`).
 */
export function newlineEdit(text: string, start: number, end: number, unit: string, language?: string): TextEdit {
    const lineStart = lineStartOf(text, start);
    const before = text.slice(lineStart, start);
    const indent = /^[ \t]*/.exec(before)![0];
    const trimmed = before.trimEnd();
    const yaml = language === "yaml" || language === "yml";
    const opens = /[{[]$/.test(trimmed) || (yaml && /:$/.test(trimmed) && !trimmed.trimStart().startsWith("#"));
    const insert = `\n${indent}${opens ? unit : ""}`;
    const caret = start + insert.length;
    return { from: start, to: end, insert, selectionStart: caret, selectionEnd: caret };
}

/** 1-based line and column of a caret offset */
export function caretPosition(text: string, pos: number): { line: number; column: number } {
    let line = 1;
    for (let i = text.indexOf("\n"); i !== -1 && i < pos; i = text.indexOf("\n", i + 1)) line++;
    return { line, column: pos - lineStartOf(text, pos) + 1 };
}
