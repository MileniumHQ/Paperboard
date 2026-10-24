import { currentFrameSession, type FrameSession } from "./frameSession";

// Browsers won't vibrate inside a cross-origin frame, so PaperUI in a panel
// frame reports the haptic it wants on window (its HAPTIC_EVENT). Forward the
// kind to the shell under this document's generation; the shell checks it
// against PaperUI's table and its own setting before anything buzzes.

/** PaperUI's HAPTIC_EVENT */
export const HAPTIC_EVENT = "paperui:haptic";
/** the message a panel or widget frame sends its shell */
export const HAPTIC_MESSAGE = "paperboard:haptic";
/** longest kind name worth forwarding; PaperUI's are all far shorter */
const KIND_MAX = 32;

export interface HapticMessage {
    type: typeof HAPTIC_MESSAGE;
    generation: string;
    kind: string;
}

/** the message for a requested haptic, or null when this frame doesn't forward one */
export function hapticMessage(detail: unknown, session: FrameSession | null): HapticMessage | null {
    if (!session || !detail || typeof detail !== "object") return null;
    const { kind } = detail as Record<string, unknown>;
    if (typeof kind !== "string" || !kind || kind.length > KIND_MAX) return null;
    return { type: HAPTIC_MESSAGE, generation: session.generation, kind };
}

if (typeof window !== "undefined" && window.parent !== window) {
    const forward = (event: Event) => {
        const message = hapticMessage((event as CustomEvent).detail, currentFrameSession());
        if (message) window.parent.postMessage(message, "*");
    };
    window.addEventListener(HAPTIC_EVENT, forward);
    window.addEventListener("pagehide", () => window.removeEventListener(HAPTIC_EVENT, forward), { once: true });
}
