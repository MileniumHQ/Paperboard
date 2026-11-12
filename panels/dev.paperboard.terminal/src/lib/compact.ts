// Whether the panel is on a phone: narrower than PaperUI's phone-layout
// width, the same line PaperPanel and PaperSlidePage draw. A panel is its own
// document, so its viewport is its width.
import { createSignal, onCleanup, type Accessor } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH } from "@mileniumhq/paperui";

export function createCompact(): Accessor<boolean> {
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [compact, setCompact] = createSignal(query.matches);
    const change = () => setCompact(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return compact;
}
