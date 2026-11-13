import { currentFrameSession } from "./frameSession";

// Mobile mode (PaperUI's paperMobile) is the shell's fact, and a panel is a
// frame of it. The shell stamps it on the document when serving it, tells it
// again when it challenges the document (`mobile` on "paperboard:initialize")
// and whenever it changes (MOBILE_MODE_MESSAGE); this writes it on the
// document root, where PaperUI reads it.

/** PaperUI's MOBILE_ATTRIBUTE */
const MOBILE_ATTRIBUTE = "data-paper-mobile";
/** the message a shell sends a panel frame when mobile mode turns on or off */
export const MOBILE_MODE_MESSAGE = "paperboard:mobile";

if (typeof window !== "undefined" && window.parent !== window) {
    const write = (on: boolean) => document.documentElement.setAttribute(MOBILE_ATTRIBUTE, on ? "true" : "false");
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || typeof event.data?.type !== "string") return;
        if (event.data.type === "paperboard:initialize" && typeof event.data.mobile === "boolean") {
            write(event.data.mobile);
        } else if (event.data.type === MOBILE_MODE_MESSAGE && event.data.generation === currentFrameSession()?.generation) {
            if (typeof event.data.mobile !== "boolean") throw new Error("The shell sent mobile mode without a true or false");
            write(event.data.mobile);
        }
    };
    window.addEventListener("message", receive);
    window.addEventListener("pagehide", () => window.removeEventListener("message", receive), { once: true });
}
