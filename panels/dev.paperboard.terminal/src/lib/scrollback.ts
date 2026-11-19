// scrollback helpers: pure, testable without a transport

export const SCROLLBACK_CHARS = 200000;

/**
 * What a shell printed while its screen was one size. A program writes for
 * the size its screen is (a shell redraws its line when the screen narrows),
 * so output replayed at another size lands in the wrong places: the screen
 * that shows it again takes each size in turn, as the live screen did. A
 * run without a size was saved before sizes were.
 */
export interface ScrollbackRun {
    cols?: number;
    rows?: number;
    text: string;
}

/** a shell's output, oldest first, in runs by the size it was printed at */
export type Scrollback = ScrollbackRun[];

/** everything the scrollback holds, as one text */
export function scrollbackText(scrollback: Scrollback): string {
    return scrollback.map((run) => run.text).join("");
}

/** adds what the shell printed to the run it was printed at; the oldest goes past the cap */
export function appendOutput(scrollback: Scrollback, chunk: string): void {
    if (scrollback.length === 0) scrollback.push({ text: "" });
    scrollback[scrollback.length - 1].text += chunk;
    let over = scrollback.reduce((sum, run) => sum + run.text.length, 0) - SCROLLBACK_CHARS;
    while (over > 0) {
        const first = scrollback[0];
        if (first.text.length <= over && scrollback.length > 1) {
            over -= first.text.length;
            scrollback.shift();
        } else {
            first.text = first.text.slice(over);
            over = 0;
        }
    }
}

/** the screen took a size: what is printed next was printed at it */
export function appendSize(scrollback: Scrollback, cols: number, rows: number): void {
    // a size nothing was printed at is no size to replay
    while (scrollback.length > 0 && !scrollback.at(-1)!.text) scrollback.pop();
    const last = scrollback.at(-1);
    if (last?.cols !== cols || last.rows !== rows) scrollback.push({ cols, rows, text: "" });
}

function isRun(raw: unknown): raw is ScrollbackRun {
    if (!raw || typeof raw !== "object") return false;
    const run = raw as Record<string, unknown>;
    const size = (n: unknown) => n === undefined || (typeof n === "number" && Number.isInteger(n) && n > 0);
    return typeof run.text === "string" && size(run.cols) && size(run.rows) && (run.cols === undefined) === (run.rows === undefined);
}

/** a scrollback as its file holds it; throws when the file isn't one */
export function parseScrollback(saved: string): Scrollback {
    const raw: unknown = JSON.parse(saved);
    if (!Array.isArray(raw) || !raw.every(isRun)) throw new Error("it isn't a saved screen");
    return raw.map((run) => (run.cols === undefined ? { text: run.text } : { cols: run.cols, rows: run.rows, text: run.text }));
}

// return the last `lineCount` whole lines of the buffer, 1 to 1000 of them
// (100 when not given). when the buffer is at its cap, the head line may be
// severed mid-command — drop the partial fragment instead of presenting it
// as a complete line
export function readWholeLines(buffer: string, lineCount?: number): string {
    const safeCount = Math.max(1, Math.min(1000, Math.trunc(Number(lineCount ?? 100))));
    if (!buffer) return "";
    const all = buffer.split("\n");
    let lines = buffer.endsWith("\n") ? all.slice(0, -1) : all;
    // only a slice that reaches back to the head line holds the fragment
    const headSevered = buffer.length >= SCROLLBACK_CHARS && lines.length <= safeCount;
    return lines.slice(headSevered ? 1 : -safeCount).join("\n");
}

// A viewer subscribes to a shell's output before it asks the service for the
// scrollback, so nothing printed in between is lost. The service saw those
// chunks in the same order, so its scrollback already ends with the first
// few of them: after the scrollback, only the chunks it doesn't hold.
export function outputAfter(scrollback: string, live: readonly string[]): string {
    let held = 0;
    let tail = "";
    for (let i = 0; i < live.length; i++) {
        tail += live[i];
        if (tail.length > scrollback.length) break;
        if (scrollback.endsWith(tail)) held = i + 1;
    }
    return live.slice(held).join("");
}
