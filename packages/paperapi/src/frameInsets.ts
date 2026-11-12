import { currentFrameSession, type FrameSession } from "./frameSession";

// A panel's frame can run to the bottom of a phone's screen, under the home
// indicator. The shell, which knows how much of the frame the indicator (or
// the keyboard) covers, tells the document with FRAME_INSETS_MESSAGE, on
// load and whenever it changes. The document then takes that as its bottom
// safe area (PaperUI's --paper-safe-area-bottom), and marks itself as
// running to the edge (data-paper-edge), so its scroll surfaces end with a
// spacer that lets the last row scroll clear.

/** the message a shell sends a panel frame when the bottom of the screen covers part of it */
export const FRAME_INSETS_MESSAGE = "paperboard:frame-insets";
/** PaperUI's EDGE_ATTRIBUTE */
const EDGE_ATTRIBUTE = "data-paper-edge";
/** PaperUI's bottom safe area token */
const SAFE_AREA_BOTTOM = "--paper-safe-area-bottom";

/** no phone covers more of a frame's foot than this; anything else is a bad message */
const INSET_MAX = 1000;

export interface FrameInsetsMessage {
    type: typeof FRAME_INSETS_MESSAGE;
    generation: string;
    /** CSS pixels at the frame's bottom edge the screen covers */
    bottom: number;
}

/** the bottom inset a message from the shell sets, or null when it isn't one this document takes */
export function frameInsetBottom(data: unknown, session: FrameSession | null): number | null {
    if (!session || session.widget || !data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.type !== FRAME_INSETS_MESSAGE || message.generation !== session.generation) return null;
    const { bottom } = message;
    if (typeof bottom !== "number" || !Number.isFinite(bottom) || bottom < 0 || bottom > INSET_MAX) return null;
    return bottom;
}

if (typeof window !== "undefined" && window.parent !== window) {
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const bottom = frameInsetBottom(event.data, currentFrameSession());
        if (bottom === null) return;
        const root = document.documentElement;
        root.style.setProperty(SAFE_AREA_BOTTOM, `${bottom}px`);
        if (bottom > 0) root.setAttribute(EDGE_ATTRIBUTE, "");
        else root.removeAttribute(EDGE_ATTRIBUTE);
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => window.removeEventListener("message", receive), { once: true });
}
