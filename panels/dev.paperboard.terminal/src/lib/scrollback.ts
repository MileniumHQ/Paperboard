// scrollback helpers: pure, testable without a transport

export const SCROLLBACK_CHARS = 200000;

export function applyScrollbackCap(chunk: string, existing: string): string {
    return (existing + chunk).slice(-SCROLLBACK_CHARS);
}

// return the last `lineCount` whole lines of the buffer. when the buffer
// is at its cap, the head line may be severed mid-command — drop the
// partial fragment instead of presenting it as a complete line
export function readWholeLines(buffer: string, lineCount: number): string {
    const safeCount = Math.max(1, Math.min(1000, Math.trunc(Number(lineCount ?? 100))));
    if (!buffer) return "";
    const all = buffer.split("\n");
    let lines = buffer.endsWith("\n") ? all.slice(0, -1) : all;
    const headSevered = buffer.length >= SCROLLBACK_CHARS;
    let slice = lines.slice(-safeCount);
    if (headSevered && slice.length > 0) {
        slice = slice.slice(1);
    }
    return slice.join("\n");
}

// A viewer subscribes to a shell's output before it asks the service for the
// scrollback, so nothing printed in between is lost. The service saw those
// chunks in the same order, so its scrollback already ends with the first
// few of them: write the scrollback, then only the chunks it doesn't hold.
export function joinScrollback(scrollback: string, live: readonly string[]): string {
    let held = 0;
    let tail = "";
    for (let i = 0; i < live.length; i++) {
        tail += live[i];
        if (tail.length > scrollback.length) break;
        if (scrollback.endsWith(tail)) held = i + 1;
    }
    return scrollback + live.slice(held).join("");
}
