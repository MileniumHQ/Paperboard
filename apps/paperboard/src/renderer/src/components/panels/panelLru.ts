// Live-iframe LRU policy (T6). Pure so it stays unit-tested; PanelView
// owns the signals and calls into this.

// Bound: at most MAX_LIVE_IFRAMES panel iframes stay mounted. Every mounted
// iframe holds its own crane connection, processes, and scrollback, so
// silent unboundedness is how the thousandth panel OOMs the shell.
export const MAX_LIVE_IFRAMES = 25;

export function recordUse(order: string[], opened: string[], current: string): string[] {
    const ordered = order.filter((k) => k !== current && opened.includes(k));
    for (const k of opened) {
        if (k !== current && !ordered.includes(k)) ordered.push(k);
    }
    if (opened.includes(current)) ordered.push(current);
    return ordered;
}

export function liveKeys(
    opened: string[],
    order: string[],
    current: string,
    max: number,
): Set<string> {
    // the active panel's liveness is reserved INSIDE the budget: taking
    // the tail slice and then unioning `current` allowed max+1 live
    // iframes whenever the current key wasn't already on the tail
    if (opened.includes(current)) {
        const others = order.filter((k) => k !== current);
        return new Set([...others.slice(-(max - 1)), current]);
    }
    return new Set(order.slice(-max));
}
