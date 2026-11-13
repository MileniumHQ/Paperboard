import { createSignal, onCleanup } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH } from "@mileniumhq/paperui";

/** The phone layout: the width at which PaperPanel puts its menu and page one over the other. Call it in a component. */
export function createCompact(): () => boolean {
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 0.02}px)`);
    const [compact, setCompact] = createSignal(query.matches);
    const change = () => setCompact(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return compact;
}
