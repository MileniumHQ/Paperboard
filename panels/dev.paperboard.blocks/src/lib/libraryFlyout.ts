// The Library's block list: Blockly's own flyout, so a block drags out of it
// the way Blockly's blocks do, kept open beside the canvas. It sits under
// the Library's header (the panel's HTML), keeps one size whatever the
// canvas is zoomed to, and is --library-width wide unless a block needs
// more; in a narrow window it takes no more than half the canvas, so the
// canvas keeps room to drop blocks on. The header takes its width from the
// list's element (CSS anchors).
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

/** The share of the canvas the Library may take, at most, before a block's own width. */
const MOST_OF_CANVAS = 0.5;

export class LibraryFlyout extends Blockly.VerticalFlyout {
    /** the width the list was last laid out to */
    private least = 0;

    constructor(options: Blockly.Options) {
        super(options);
        // a gap around and between blocks
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

    /** whether the Library is open: Blockly shows the list each time it fills it, so it asks here */
    private shown = true;

    /** Opens or collapses the Library's list. Shown again, it is laid out for the canvas beside it now. */
    setShown(shown: boolean): void {
        this.shown = shown;
        this.setVisible(shown);
        if (shown) this.reflow();
    }

    /** Blockly shows the list as it fills it (show), and a collapsed Library keeps it hidden. */
    override setVisible(visible: boolean): void {
        super.setVisible(visible && this.shown);
    }

    /**
     * Shown or hidden again as it should be: a new theme makes the list's own
     * workspace show itself, whether or not the Library is shown.
     */
    redisplay(): void {
        (this as unknown as { updateDisplay(): void }).updateDisplay();
    }

    /** --library-width, or half the canvas where that is less. */
    private leastWidth(): number {
        const host = this.targetWorkspace.getInjectionDiv();
        return Math.min(cssPixels(host, "--library-width"), Math.floor(host.clientWidth * MOST_OF_CANVAS));
    }

    override position(): void {
        if (!this.isVisible() || !this.targetWorkspace.isVisible()) return;
        // the window was resized past where the list's width changes: laid out again, which positions it
        if (this.leastWidth() !== this.least) return this.reflow();
        const view = this.targetWorkspace.getMetricsManager().getViewMetrics();
        this.height_ = Math.max(0, view.height - top);
        // square: it meets the header above and the canvas beside it
        (this as unknown as { setBackgroundPath(width: number, height: number): void }).setBackgroundPath(this.getWidth() - this.CORNER_RADIUS, this.height_ - 2 * this.CORNER_RADIUS);
        this.positionAt_(this.getWidth(), this.height_, this.getX(), top);
    }

    /** As wide as the Library, or the widest block where one won't fit: a block is never cut off. */
    protected override reflowInternal_(): void {
        // first, as the layout below positions the list, which would lay it out again for a width it hasn't taken yet
        this.least = this.leastWidth();
        super.reflowInternal_();
        if (this.width_ < this.least) {
            this.width_ = this.least;
            this.position();
            this.targetWorkspace.resizeContents();
            this.targetWorkspace.recordDragTargets();
        }
    }
}

Blockly.registry.register(Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX, LIBRARY_FLYOUT, LibraryFlyout, true);
