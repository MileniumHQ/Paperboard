import { currentFrameSession, type FrameSession } from "./frameSession";

// A panel frame showing its list has no page of its own to go back from, so
// PaperUI reports a finger's back swipe on window (its SWIPE_BACK_EVENT). The
// shell holds the page this frame is in: forward the swipe there, under this
// document's generation. A Home widget is not a page; its swipes stay its own.

/** PaperUI's SWIPE_BACK_EVENT */
export const SWIPE_BACK_EVENT = "paperui:swipe-back";
/** the message a panel frame sends its shell */
export const SWIPE_BACK_MESSAGE = "paperboard:swipe-back";

export interface SwipeBackMessage {
    type: typeof SWIPE_BACK_MESSAGE;
    generation: string;
    phase: "move" | "end" | "cancel";
    dx: number;
    velocity: number;
}

/** the message for a reported swipe, or null when this frame doesn't forward one */
export function swipeBackMessage(detail: unknown, session: FrameSession | null): SwipeBackMessage | null {
    if (!session || session.widget || !detail || typeof detail !== "object") return null;
    const { phase, dx, velocity } = detail as Record<string, unknown>;
    if (phase !== "move" && phase !== "end" && phase !== "cancel") return null;
    if (typeof dx !== "number" || typeof velocity !== "number") return null;
    return { type: SWIPE_BACK_MESSAGE, generation: session.generation, phase, dx, velocity };
}

if (typeof window !== "undefined" && window.parent !== window) {
    const forward = (event: Event) => {
        const message = swipeBackMessage((event as CustomEvent).detail, currentFrameSession());
        if (message) window.parent.postMessage(message, "*");
    };
    window.addEventListener(SWIPE_BACK_EVENT, forward);
    window.addEventListener("pagehide", () => window.removeEventListener(SWIPE_BACK_EVENT, forward), { once: true });
}
