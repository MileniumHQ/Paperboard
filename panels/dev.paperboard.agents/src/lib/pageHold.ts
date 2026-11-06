// A page in the workspace menu reads its data as it opens. Until that first
// read is in, the page it replaces stays on screen, so switching pages never
// paints an empty page (or a loader for a frame) between the two.

import { createContext, useContext } from "solid-js";

/** Takes a page's first read; the switch waits for it to settle, or for a moment at most. */
export const PageHold = createContext<(read: Promise<unknown>) => void>();

/** Hold the page before this one on screen until `read` settles. Outside the workspace there's nothing to hold. */
export function holdPage(read: Promise<unknown>): void {
    useContext(PageHold)?.(read);
}
