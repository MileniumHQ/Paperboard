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
