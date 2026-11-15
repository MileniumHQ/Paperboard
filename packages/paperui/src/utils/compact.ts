import { createSignal, onCleanup, type Accessor } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH } from "../templates/PaperPanel";

/**
 * Whether the page has the phone layout: narrower than
 * PAPER_PANEL_COMPACT_WIDTH, the line PaperPanel draws. A panel is its own
 * document, so its viewport is its width. For a view outside a PaperPanel
 * (a home screen before one opens); inside one, ask
 * usePaperPanel().compact. Call it in a component.
 */
export function createPaperCompact(): Accessor<boolean> {
    // the width just under the line: a max-width query includes its own number
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 0.02}px)`);
    const [compact, setCompact] = createSignal(query.matches);
    const change = () => setCompact(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return compact;
}
