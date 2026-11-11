// What a command gives back, the Scratch "ask and wait" way with the answer
// kept in the block: a command that gives something back has a gear, and
// the gear opens a tray of reporters, the value and each of its fields.
// Each reporter dragged out of it reads that one block's result, by its id.
import * as Blockly from "blockly";

/** The mutator a result block keeps the block it reads in. */
export const RESULT_SOURCE = "pb_result_source";
/** The extension that gives a command that gives something back its gear. */
export const RESULTS_GEAR = "pb_results_gear";

/** A result block's saved state: the block whose result it reads. */
export interface ResultSource {
    from: string;
}

type ResultBlock = Blockly.Block & { resultFrom?: string };

export const RESULTS_ICON = new Blockly.icons.IconType<ResultsIcon>("pb_results");

/** Blockly's gear is this wide; the Paper renderer draws both alike. */
const GEAR_SIZE = 17;

/** The blocks in each command's tray, by command block type. */
let trayBlocks: Record<string, string[]> = {};

export function setResultBlocks(results: Record<string, string[]>): void {
    trayBlocks = results;
}

const trays = new WeakMap<Blockly.WorkspaceSvg, ResultsTray>();

/** The block a result block reads, or null when the block isn't on the canvas any more. */
export function sourceOf(block: Blockly.Block): Blockly.Block | null {
    const from = (block as ResultBlock).resultFrom;
    if (!from) throw new Error(`${block.type} names no block to read`);
    return block.workspace.getBlockById(from);
}

/** A command's gear: a click opens the tray of what it gives back. */
export class ResultsIcon extends Blockly.icons.Icon {
    /** the tray was open for this block when the click began, so the click closes it */
    private wasOpen = false;

    override getType(): Blockly.icons.IconType<ResultsIcon> {
        return RESULTS_ICON;
    }

    override initView(pointerdownListener: (e: PointerEvent) => void): void {
        if (this.svgRoot) return;
        super.initView(pointerdownListener);
        // the shape Blockly's gear has; paperRenderer.ts puts PaperUI's symbol on it
        Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.RECT, { class: "blocklyIconShape", rx: "4", ry: "4", height: "16", width: "16" }, this.svgRoot);
        Blockly.utils.dom.addClass(this.svgRoot!, "blocklyMutatorIcon");
        // before Blockly's own listener, which closes the tray as the click starts
        this.svgRoot!.addEventListener("pointerdown", () => (this.wasOpen = trayOf(this.block()).isOpenFor(this.block())), { capture: true });
    }

    override getWeight(): number {
        return 1;
    }

    override getSize(): Blockly.utils.Size {
        return new Blockly.utils.Size(GEAR_SIZE, GEAR_SIZE);
    }

    override isClickableInFlyout(): boolean {
        return false;
    }

    override onClick(): void {
        const tray = trayOf(this.block());
        if (this.wasOpen) tray.close();
        else tray.open(this.block());
        this.wasOpen = false;
    }

    protected override getAriaLabel(): string {
        return "What it gives back";
    }

    private block(): Blockly.BlockSvg {
        return this.sourceBlock as Blockly.BlockSvg;
    }
}

function trayOf(block: Blockly.BlockSvg): ResultsTray {
    const tray = trays.get(block.workspace);
    if (!tray) throw new Error("This canvas has no tray for what blocks give back");
    return tray;
}

/**
 * The tray: Blockly's flyout, so its blocks drag out onto the canvas as the
 * Library's do, held under the gear it opened from. It closes when the
 * canvas is clicked or zoomed, or its block goes.
 */
class ResultsTray extends Blockly.VerticalFlyout {
    private owner: Blockly.BlockSvg | null = null;

    constructor(options: Blockly.Options, private readonly gap: number) {
        super(options);
        const spacing = this as unknown as { MARGIN: number; GAP_Y: number };
        spacing.MARGIN = gap;
        spacing.GAP_Y = gap;
        // a click on a block in it doesn't drop a copy on the canvas; a drag does
        this.autoClose = false;
    }

    isOpenFor(block: Blockly.BlockSvg): boolean {
        return this.isVisible() && this.owner === block;
    }

    open(block: Blockly.BlockSvg): void {
        const types = trayBlocks[block.type];
        if (!types?.length) throw new Error(`${block.type} gives nothing back, so its gear has nothing to show`);
        this.owner = block;
        this.show(types.map((type) => ({ kind: "block", type, extraState: { from: block.id } satisfies ResultSource })));
    }

    close(): void {
        this.owner = null;
        this.hide();
    }

    override autoHide(onlyClosePopups: boolean): void {
        if (!onlyClosePopups) this.close();
    }

    /** Where the canvas has moved its block. */
    follow(event: Blockly.Events.Abstract): void {
        if (!this.owner || !this.isVisible()) return;
        if (this.owner.isDeadOrDying() || (event.type === Blockly.Events.BLOCK_DRAG && (event as Blockly.Events.BlockDrag).blockId === this.owner.id)) {
            this.close();
            return;
        }
        if (event.type === Blockly.Events.BLOCK_MOVE || event.type === Blockly.Events.VIEWPORT_CHANGE) this.position();
    }

    override position(): void {
        if (!this.isVisible() || !this.owner) return;
        const gear = this.owner.getIcon(RESULTS_ICON);
        if (!gear) throw new Error(`${this.owner.type} has no gear to open its tray under`);
        const canvas = this.targetWorkspace.getInjectionDiv().getBoundingClientRect();
        const at = gear.getFocusableElement().getBoundingClientRect();
        const scale = this.getWorkspace().scale;
        const bottom = this.getContents().reduce((most, item) => Math.max(most, item.getElement().getBoundingRectangle().bottom), 0);
        const x = at.left - canvas.left;
        const y = at.bottom - canvas.top + this.gap / 2;
        // as tall as its blocks, or the room under the gear, scrolling past that
        this.height_ = Math.max(0, Math.min((bottom + this.gap) * scale, canvas.height - y - this.gap));
        const radius = this.gap / 2;
        const w = this.getWidth();
        const h = this.height_;
        this.svgBackground_?.setAttribute(
            "d",
            `M ${radius} 0 H ${w - radius} A ${radius} ${radius} 0 0 1 ${w} ${radius} V ${h - radius} A ${radius} ${radius} 0 0 1 ${w - radius} ${h} H ${radius} A ${radius} ${radius} 0 0 1 0 ${h - radius} V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`,
        );
        this.positionAt_(w, h, x, y);
    }

    /** Only the tray itself: a block dropped on it goes, as one dropped on the Library does. */
    override getClientRect(): Blockly.utils.Rect | null {
        if (!this.isVisible()) return null;
        const r = this.svgGroup_!.getBoundingClientRect();
        return new Blockly.utils.Rect(r.top, r.bottom, r.left, r.right);
    }
}

/** Gives a canvas its tray; the class is its look (Editor.module.css). */
export function addResultsTray(workspace: Blockly.WorkspaceSvg, className: string, gap: number): void {
    const tray = new ResultsTray(workspace.copyOptionsForFlyout(), gap);
    const svg = tray.createDom(Blockly.utils.Svg.SVG);
    Blockly.utils.dom.addClass(svg, className);
    workspace.getInjectionDiv().appendChild(svg);
    tray.init(workspace);
    trays.set(workspace, tray);
    workspace.addChangeListener((event) => tray.follow(event));
}

function registerResults(): void {
    if (!Blockly.Extensions.isRegistered(RESULT_SOURCE)) {
        Blockly.Extensions.registerMutator(RESULT_SOURCE, {
            saveExtraState(this: ResultBlock): ResultSource {
                if (!this.resultFrom) throw new Error(`${this.type} names no block to read`);
                return { from: this.resultFrom };
            },
            loadExtraState(this: ResultBlock, state: unknown): void {
                const from = (state as Partial<ResultSource> | null)?.from;
                if (typeof from !== "string" || !from) throw new Error(`${this.type} was saved without the block it reads`);
                this.resultFrom = from;
            },
        });
    }
    if (!Blockly.Extensions.isRegistered(RESULTS_GEAR)) {
        Blockly.Extensions.register(RESULTS_GEAR, function (this: Blockly.Block) {
            this.addIcon(new ResultsIcon(this));
        });
    }
}

registerResults();
