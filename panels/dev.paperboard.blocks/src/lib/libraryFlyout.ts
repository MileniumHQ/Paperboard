// The Library's block list: Blockly's own flyout, so a block drags out of it
// the way Blockly's blocks do, kept open beside the canvas. It sits under
// the Library's header (the panel's HTML), keeps one size whatever the
// canvas is zoomed to, and is --library-width wide unless a block needs
// more. The header takes its width from the list's element (CSS anchors).
import * as Blockly from "blockly";
import { tokenPixels } from "./tokens";

export const LIBRARY_FLYOUT = "pbLibraryFlyout";

/** How far down the list starts, under the header. */
let top = 0;

export function setLibraryTop(next: number): void {
    top = next;
}

/** A length the page's CSS sets, in pixels: Blockly lays the list out in numbers. */
function cssPixels(from: Element, property: string): number {
    const value = parseFloat(getComputedStyle(from).getPropertyValue(property));
    if (!Number.isFinite(value)) throw new Error(`${property} isn't set, so the Library can't be laid out`);
    return value;
}

/** PaperUI's gap, in pixels. */
export function uiGap(): number {
    return tokenPixels("--paper-uigap");
}

export class LibraryFlyout extends Blockly.VerticalFlyout {
    constructor(options: Blockly.Options) {
        super(options);
        // spaced as the Actions library is: a gap around and between blocks
        const spacing = this as unknown as { MARGIN: number; GAP_Y: number };
        spacing.MARGIN = uiGap();
        spacing.GAP_Y = uiGap();
    }

    override getFlyoutScale(): number {
        return 1;
    }

    override getY(): number {
        return top;
    }

    override position(): void {
        if (!this.isVisible() || !this.targetWorkspace.isVisible()) return;
        const view = this.targetWorkspace.getMetricsManager().getViewMetrics();
        this.height_ = Math.max(0, view.height - top);
        // square: it meets the header above and the canvas beside it
        (this as unknown as { setBackgroundPath(width: number, height: number): void }).setBackgroundPath(this.getWidth() - this.CORNER_RADIUS, this.height_ - 2 * this.CORNER_RADIUS);
        this.positionAt_(this.getWidth(), this.height_, this.getX(), top);
    }

    /** As wide as the Actions library, or the widest block where one won't fit: a block is never cut off. */
    protected override reflowInternal_(): void {
        super.reflowInternal_();
        const least = cssPixels(this.targetWorkspace.getInjectionDiv(), "--library-width");
        if (this.width_ < least) {
            this.width_ = least;
            this.position();
            this.targetWorkspace.resizeContents();
            this.targetWorkspace.recordDragTargets();
        }
    }
}

Blockly.registry.register(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX, LIBRARY_FLYOUT, LibraryFlyout, true);
