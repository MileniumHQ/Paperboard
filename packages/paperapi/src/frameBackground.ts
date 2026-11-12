import { currentFrameSession, type FrameSession } from "./frameSession";

// A panel frame stops above a phone's home indicator; the shell fills the
// strip below it with the color along the panel's bottom edge, so the strip
// reads as the panel's own. PaperUI reports that color on window (its
// FRAME_BACKGROUND_EVENT), and this forwards it under this document's
// generation.

/** PaperUI's FRAME_BACKGROUND_EVENT */
export const FRAME_BACKGROUND_EVENT = "paperui:frame-background";
/** the message a panel frame sends its shell */
export const FRAME_BACKGROUND_MESSAGE = "paperboard:frame-background";

// a computed color only: the shell sets it as a style
const COLOR = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/;

export interface FrameBackgroundMessage {
    type: typeof FRAME_BACKGROUND_MESSAGE;
    generation: string;
    color: string;
}

/** whether a frame-background message's color is one a shell may set */
export function isFrameBackgroundColor(color: unknown): color is string {
    return typeof color === "string" && COLOR.test(color);
}

/** the message for a reported color, or null when this frame doesn't forward it */
export function frameBackgroundMessage(detail: unknown, session: FrameSession | null): FrameBackgroundMessage | null {
    if (!session || session.widget || !detail || typeof detail !== "object") return null;
    const { color } = detail as Record<string, unknown>;
    if (!isFrameBackgroundColor(color)) return null;
    return { type: FRAME_BACKGROUND_MESSAGE, generation: session.generation, color };
}

if (typeof window !== "undefined" && window.parent !== window) {
    // a color reported before the shell's challenge is sent once it arrives
    let latest: unknown = null;
    const forward = () => {
        const message = frameBackgroundMessage(latest, currentFrameSession());
        if (message) window.parent.postMessage(message, "*");
    };
    const onColor = (event: Event) => {
        latest = (event as CustomEvent).detail;
        forward();
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== "paperboard:initialize") return;
        // the session is set by the same message; send once it is
        queueMicrotask(forward);
    };
    window.addEventListener(FRAME_BACKGROUND_EVENT, onColor);
    window.addEventListener("message", receive);
    window.addEventListener(
        "pagehide",
        () => {
            window.removeEventListener(FRAME_BACKGROUND_EVENT, onColor);
            window.removeEventListener("message", receive);
        },
        { once: true },
    );
}
