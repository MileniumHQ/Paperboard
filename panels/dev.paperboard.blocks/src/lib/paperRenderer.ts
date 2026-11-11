// Blocks drawn the Scratch way: Blockly's zelos renderer puts a value inside
// the block it feeds (a rounded pill, or a hexagon for true or false), and
// steps stack on a notch. Here it's sized, spaced, rounded and lettered by
// PaperUI's tokens, coloured by blockStyles.ts, and every block shows its
// icon before its text.
import * as Blockly from "blockly";
import { getVarCss } from "@mileniumhq/paperui";
import { blockIcon, blockStyles, type BlockIcon } from "./blockStyles";

export const PAPER_RENDERER = "paper";
const ICON_FIELD = "PAPER_ICON";
/** the class of a built-in block's symbol */
const SYMBOL_CLASS = "paperBlockSymbol";
/** Blockly sizes block text in points */
const POINTS_PER_PIXEL = 0.75;

function token(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!value) throw new Error(`${name} isn't set, so blocks can't be drawn`);
    return value;
}

function tokenPixels(name: string): number {
    const value = parseFloat(token(name));
    if (!Number.isFinite(value)) throw new Error(`${name} isn't a length, so blocks can't be drawn`);
    return value;
}

/** Block text: Actions' block titles, a touch heavier to read on colour. */
function blockFont() {
    return { family: token("--paper-font-family"), weight: token("--paper-weight-semibold"), pixels: tokenPixels("--paper-text-size-3") };
}

/**
 * Waits for the fonts blocks are drawn in: Blockly measures text once, so a
 * block measured in a stand-in font keeps the stand-in's size.
 */
export async function loadBlockFonts(): Promise<void> {
    const font = blockFont();
    const loads = [
        document.fonts.load(`${font.weight} ${font.pixels}px ${font.family}`),
        document.fonts.load(`${tokenPixels("--paper-icon-size-medium")}px ${token("--paper-icon-font-family")}`, "extension"),
    ];
    for (const faces of await Promise.all(loads)) if (faces.length === 0) throw new Error("PaperUI's fonts aren't on this page");
}

/** PaperUI's colours and font, as a Blockly theme. */
export function paperTheme(): Blockly.Theme {
    const font = blockFont();
    return Blockly.Theme.defineTheme("paper", {
        name: "paper",
        blockStyles: blockStyles(),
        fontStyle: { family: font.family, weight: font.weight, size: font.pixels * POINTS_PER_PIXEL },
        // a block that starts a flow wears a cap, as Scratch's hats do
        startHats: true,
    });
}

/**
 * A built-in block's symbol: a Material Symbol, as PaperIcon draws one. A
 * label, so zelos keeps it at the start of the row as it does text.
 */
class SymbolField extends Blockly.FieldLabel {
    constructor(symbol: string) {
        super(symbol, SYMBOL_CLASS);
    }

    // the glyph's name draws the symbol, but isn't the block's text: a
    // screen reader or a search reads "Wait", not "alt_route Wait"
    protected override getText_(): string {
        return "";
    }

    protected override getDisplayText_(): string {
        return this.getValue()!;
    }

    protected override updateSize_(): void {
        // a symbol is as wide as it is tall
        const size = tokenPixels("--paper-icon-size-medium");
        this.size_ = new Blockly.utils.Size(size, size);
        this.textElement_!.setAttribute("x", "0");
        this.textElement_!.setAttribute("y", String(size / 2));
        this.textElement_!.setAttribute("dominant-baseline", "central");
    }
}

function iconField(icon: BlockIcon): Blockly.Field {
    if ("symbol" in icon) return new SymbolField(icon.symbol);
    const size = tokenPixels("--paper-icon-size-medium");
    return new Blockly.FieldImage(icon.src, size, size, "");
}

function sameIcon(field: Blockly.Field, icon: BlockIcon): boolean {
    return "symbol" in icon ? field instanceof SymbolField && field.getValue() === icon.symbol : field instanceof Blockly.FieldImage && field.getValue() === icon.src;
}

/**
 * Puts the block's icon first in its first row. Done as it's drawn, so it
 * holds for any block, Blockly's included, after one rebuilds its rows (a
 * "join" given more items). Shadows, the values typed into a socket, have none.
 */
function placeIcon(block: Blockly.BlockSvg): void {
    const current = block.getField(ICON_FIELD);
    const first = block.isShadow() ? undefined : block.inputList[0];
    const icon = first ? blockIcon(block) : undefined;
    if (current && icon && first!.fieldRow[0] === current && sameIcon(current, icon)) return;
    if (current) current.getParentInput().removeField(ICON_FIELD, true);
    if (icon) first!.insertFieldAt(0, iconField(icon), ICON_FIELD);
}

class PaperConstants extends Blockly.zelos.ConstantProvider {
    constructor() {
        // zelos measures in grid units: a third of PaperUI's gap, so its
        // padding, notches and heights follow the gap
        super(tokenPixels("--paper-uigap") / 3);
        this.CORNER_RADIUS = tokenPixels("--paper-border-radius-half");
        this.TOP_ROW_MIN_HEIGHT = this.CORNER_RADIUS;
        this.BOTTOM_ROW_MIN_HEIGHT = this.CORNER_RADIUS;
        this.FIELD_BORDER_RECT_RADIUS = this.CORNER_RADIUS;
        this.SELECTED_GLOW_COLOUR = token("--paper-primary");
    }

    // Blockly's renderer CSS, with PaperUI's colours where zelos has Scratch's
    override getCSS_(selector: string): string[] {
        const font = `${this.FIELD_TEXT_FONTWEIGHT} ${this.FIELD_TEXT_FONTSIZE}pt ${this.FIELD_TEXT_FONTFAMILY}`;
        const fieldText = [">text", ">g>text"].flatMap((child) => [`${selector} .blocklyNonEditableField${child}`, `${selector} .blocklyEditableField${child}`]).join(",");
        return [
            `${selector} .blocklyText, ${selector} .blocklyFlyoutLabelText { font: ${font}; }`,
            `${selector} .blocklyTextInputBubble textarea { font-weight: ${getVarCss("weight-regular")}; }`,
            `${selector} .blocklyText { fill: ${getVarCss("on-color")}; }`,
            `${selector} .${SYMBOL_CLASS} { font-family: ${getVarCss("icon-font-family")}; font-size: ${getVarCss("icon-size-medium")}; font-weight: ${getVarCss("weight-regular")}; font-variation-settings: "FILL" 1, "wght" 500, "GRAD" 0, "opsz" 14; }`,
            // a field you type into, as PaperUI's input
            `${selector} .blocklyNonEditableField>rect:not(.blocklyDropdownRect), ${selector} .blocklyEditableField>rect:not(.blocklyDropdownRect) { fill: ${getVarCss("surface")}; }`,
            `${fieldText} { fill: ${getVarCss("text")}; }`,
            `${selector} .blocklyFlyoutLabelText { fill: ${getVarCss("text-subtle")}; }`,
            `${selector} .blocklyText.blocklyBubbleText { fill: ${getVarCss("text")}; }`,
            `${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>rect, ${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>.blocklyPath { stroke: ${getVarCss("primary")}; stroke-width: ${getVarCss("thick-border-width")}; }`,
            `${selector} .blocklyHtmlInput { font-family: ${this.FIELD_TEXT_FONTFAMILY}; font-weight: ${this.FIELD_TEXT_FONTWEIGHT}; color: ${getVarCss("text")}; background: ${getVarCss("surface")}; }`,
            `${selector} .blocklyDropdownText { fill: ${getVarCss("on-color")} !important; }`,
            `${selector}.blocklyWidgetDiv .blocklyMenuItem, ${selector}.blocklyDropDownDiv .blocklyMenuItem { font-family: ${this.FIELD_TEXT_FONTFAMILY}; }`,
            `${selector}.blocklyDropDownDiv .blocklyMenuItemContent { color: ${getVarCss("on-color")}; }`,
            `${selector} .blocklyHighlightedConnectionPathVisible { stroke: ${getVarCss("primary")}; }`,
            `${selector} .blocklyDisabledPattern > .blocklyOutlinePath { fill: var(--blocklyDisabledPattern); }`,
            `${selector} .blocklyInsertionMarker>.blocklyPath { fill-opacity: ${this.INSERTION_MARKER_OPACITY}; stroke: none; }`,
            `${selector} .blocklySelected>.blocklyPath.blocklyPathSelected { fill: none; filter: var(--blocklySelectedGlowFilter); }`,
        ];
    }
}

class PaperRenderer extends Blockly.zelos.Renderer {
    protected override makeConstants_(): Blockly.zelos.ConstantProvider {
        return new PaperConstants();
    }

    override render(block: Blockly.BlockSvg): void {
        placeIcon(block);
        super.render(block);
    }
}

Blockly.blockRendering.register(PAPER_RENDERER, PaperRenderer);
