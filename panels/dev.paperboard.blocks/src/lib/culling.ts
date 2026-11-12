// Blockly paints every block on the canvas each time the view moves, on
// screen or not, so a big project pans at a few frames a second on a slow
// computer. A stack wholly out of view, by more than a quarter of a view
// each way, is taken out of the page until the view comes near it. It's
// checked every frame the view moves, and the margin covers how far a fast
// pan gets in one. Blockly measures text with a canvas and the computed
// font, both of which a hidden block still has.
import * as Blockly from "blockly";

/** How far past the view a stack stays drawn, as a share of the view each way. */
const MARGIN = 0.25;

/** Hides the stacks far out of view as the view and the blocks move; returns what stops it. */
export function cullOffscreenStacks(workspace: Blockly.WorkspaceSvg): () => void {
    let frame = 0;
    const update = () => {
        frame = 0;
        const view = workspace.getMetricsManager().getViewMetrics(true);
        const left = view.left - view.width * MARGIN;
        const right = view.left + view.width * (1 + MARGIN);
        const top = view.top - view.height * MARGIN;
        const bottom = view.top + view.height * (1 + MARGIN);
        for (const block of workspace.getTopBlocks(false)) {
            const r = block.getBoundingRectangle();
            const away = !block.isDragging() && (r.right < left || r.left > right || r.bottom < top || r.top > bottom);
            const root = block.getSvgRoot();
            if ((root.style.display === "none") !== away) root.style.display = away ? "none" : "";
        }
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update);
    };
    workspace.addChangeListener(schedule);
    schedule();
    return () => {
        workspace.removeChangeListener(schedule);
        cancelAnimationFrame(frame);
        for (const block of workspace.getTopBlocks(false)) block.getSvgRoot().style.display = "";
    };
}
