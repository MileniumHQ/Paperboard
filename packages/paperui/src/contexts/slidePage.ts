import { createContext, useContext } from "solid-js";

/**
 * Set by PaperSlidePage for its content: the title its bar shows (its own
 * bar, or the shell's when the host draws the frame's bars), or undefined in
 * the wide layout, where the page draws no bar. A PaperPageHeader inside
 * reads it so it doesn't say the same title again.
 */
export const PaperSlidePageTitleContext = createContext<() => string | undefined>();

/** the title the enclosing phone-layout page's bar shows, if any */
export function useSlidePageTitle(): () => string | undefined {
    const title = useContext(PaperSlidePageTitleContext);
    return () => title?.();
}
