import { currentFrameSession, type FrameSession } from "./frameSession";

// A panel's own pages (PaperUI's PaperSlidePage on a phone) are named in the
// shell's top bar, after the panel's name: PaperUI reports their titles on
// window (its PAGE_CRUMBS_EVENT), and this forwards them under this
// document's generation. A shell that draws them says so when it challenges
// the document (`pageBars`); the pages then draw no bar of their own, and the
// shell's Back reaches the innermost one as "paperboard:back".

/** PaperUI's PAGE_CRUMBS_EVENT */
export const PAGE_CRUMBS_EVENT = "paperui:page-crumbs";
/** PaperUI's HOST_BARS_ATTRIBUTE */
const HOST_BARS_ATTRIBUTE = "data-paper-host-bars";
/** the message a panel frame sends its shell */
export const PAGE_CRUMBS_MESSAGE = "paperboard:page-crumbs";
/** the message a shell sends a panel frame to go back one page */
export const PAGE_BACK_MESSAGE = "paperboard:page-back";

/** pages deep worth naming; a phone's bar has room for far fewer */
const CRUMBS_MAX = 8;
const CRUMB_CHARS_MAX = 80;

export interface PageCrumbsMessage {
    type: typeof PAGE_CRUMBS_MESSAGE;
    generation: string;
    titles: string[];
}

/** the message for reported crumbs, or null when this frame doesn't forward them */
export function pageCrumbsMessage(detail: unknown, session: FrameSession | null): PageCrumbsMessage | null {
    if (!session || session.widget || !detail || typeof detail !== "object") return null;
    const { titles } = detail as Record<string, unknown>;
    if (!Array.isArray(titles)) return null;
    const clean = titles
        .slice(0, CRUMBS_MAX)
        .map((title) => (typeof title === "string" ? title.trim().slice(0, CRUMB_CHARS_MAX) : ""));
    return { type: PAGE_CRUMBS_MESSAGE, generation: session.generation, titles: clean };
}

if (typeof window !== "undefined" && window.parent !== window) {
    // pages open before the shell's challenge are named once it arrives
    let latest: unknown = { titles: [] };
    const forward = () => {
        const message = pageCrumbsMessage(latest, currentFrameSession());
        if (message) window.parent.postMessage(message, "*");
    };
    const onCrumbs = (event: Event) => {
        latest = (event as CustomEvent).detail;
        forward();
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || typeof event.data?.type !== "string") return;
        if (event.data.type === "paperboard:initialize" && typeof event.data.generation === "string" && event.data.widget === undefined) {
            if (event.data.pageBars === true) document.documentElement.setAttribute(HOST_BARS_ATTRIBUTE, "");
            else document.documentElement.removeAttribute(HOST_BARS_ATTRIBUTE);
            // the session is set by the same message; name the pages once it is
            queueMicrotask(forward);
        } else if (event.data.type === PAGE_BACK_MESSAGE && event.data.generation === currentFrameSession()?.generation) {
            window.dispatchEvent(new Event("paperboard:back", { cancelable: true }));
        }
    };
    window.addEventListener(PAGE_CRUMBS_EVENT, onCrumbs);
    window.addEventListener("message", receive);
    window.addEventListener(
        "pagehide",
        () => {
            window.removeEventListener(PAGE_CRUMBS_EVENT, onCrumbs);
            window.removeEventListener("message", receive);
        },
        { once: true },
    );
}
