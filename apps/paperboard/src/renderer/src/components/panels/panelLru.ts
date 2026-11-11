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

// A panel left out of view this long has its page unloaded. Every loaded
// panel is a renderer process of its own (a few dozen megabytes); one opened
// once and never returned to would otherwise be held until Paperboard quits.
// Coming back loads it again, as opening it did: a panel keeps what matters
// in its service, not in its page.
export const IDLE_UNLOAD_MS = 15 * 60_000;

/** When each opened panel went out of view; the one in view has no entry. */
export function recordAway(away: Record<string, number>, opened: string[], current: string, now: number): Record<string, number> {
    const next: Record<string, number> = {};
    for (const key of opened) {
        if (key === current) continue;
        next[key] = away[key] ?? now;
    }
    return next;
}

/** The live panels that have not been out of view for `idleMs`. */
export function withoutIdle(live: Set<string>, away: Record<string, number>, current: string, now: number, idleMs: number): Set<string> {
    const kept = new Set<string>();
    for (const key of live) {
        const since = away[key];
        if (key === current || since === undefined || now - since < idleMs) kept.add(key);
    }
    return kept;
}
