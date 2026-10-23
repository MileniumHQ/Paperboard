// Stick-to-bottom for the chat: a reader at the bottom stays there while a
// reply streams, tool calls land and requests appear; a reader who scrolled
// up is left where they are. Only scroll events change whether the view is
// pinned, so the decision made when content changes is the one from before
// the change. lib/stickToBottom.ts wires it to the DOM.

/** how close to the bottom still counts as at the bottom */
export const AT_BOTTOM_PX = 48;

export interface ScrollMetrics {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

export function isAtBottom(m: ScrollMetrics, threshold = AT_BOTTOM_PX): boolean {
    return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold;
}

/**
 * Whether the view is pinned after a scroll event. Reaching the bottom pins
 * it; only a scroll up lets go. A scroll that is not up and not at the bottom
 * (the browser keeping content in place as it grows) keeps what it was.
 */
export function pinnedAfterScroll(pinned: boolean, previousTop: number, m: ScrollMetrics): boolean {
    if (isAtBottom(m)) return true;
    if (m.scrollTop < previousTop) return false;
    return pinned;
}
