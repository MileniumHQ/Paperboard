import { createSignal, onCleanup, type Accessor } from "solid-js";

// Mobile mode: whether Paperboard is running as the phone app (a phone, or
// its --mobile mock). It decides BEHAVIOR that differs between a finger and
// a mouse: long-press menus, text selection, hover-only affordances,
// haptics, swipe gestures. LAYOUT (sizes, columns, stacking, spacing) never
// asks it: that follows the width, with PAPER_PANEL_COMPACT_WIDTH.
//
// The host owns the fact and writes it on the document root, a panel's
// <html> included (PaperAPI relays the shell's changes to a framed panel),
// so CSS reads `:root[data-paper-mobile="true"]` and TypeScript reads
// paperMobile(). A document the host never told is an error, not "desktop".

/** set on the root by the host: "true" in mobile mode, "false" outside it */
export const MOBILE_ATTRIBUTE = "data-paper-mobile";

const MISSING = `Mobile mode is unknown: the host never set ${MOBILE_ATTRIBUTE} on this document. A panel gets it from Paperboard, and a page outside Paperboard sets it with setPaperMobile().`;

function readMobile(root: HTMLElement): boolean {
    const value = root.getAttribute(MOBILE_ATTRIBUTE);
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(value === null ? MISSING : `${MOBILE_ATTRIBUTE} must be "true" or "false", not "${value}"`);
}

/** Whether Paperboard is in mobile mode. Throws when the host never said. */
export function paperMobile(root: HTMLElement = document.documentElement): boolean {
    return readMobile(root);
}

/** Writes mobile mode on the root. Hosts call it; panels only read. */
export function setPaperMobile(on: boolean, root: HTMLElement = document.documentElement): void {
    root.setAttribute(MOBILE_ATTRIBUTE, on ? "true" : "false");
}

/** A reactive paperMobile(): follows the host as it changes. Throws when the host never said. */
export function createPaperMobile(root: HTMLElement = document.documentElement): Accessor<boolean> {
    const [mobile, setMobile] = createSignal(readMobile(root));
    const observer = new MutationObserver(() => setMobile(readMobile(root)));
    observer.observe(root, { attributes: true, attributeFilter: [MOBILE_ATTRIBUTE] });
    onCleanup(() => observer.disconnect());
    return mobile;
}
