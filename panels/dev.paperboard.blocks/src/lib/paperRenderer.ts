// Blocks drawn the Scratch way: Blockly's zelos renderer puts a value inside
// the block it feeds (a rounded pill, or a hexagon for true or false), and
// steps stack on a notch. Here it's sized, spaced, rounded and lettered by
// PaperUI's tokens, coloured by blockStyles.ts, and every block shows its
// icon before its text.
import * as Blockly from "blockly";
import { token, tokenPixels } from "./tokens";
import { getVarCss } from "@mileniumhq/paperui";
import { blockIcon, blockStyles, type BlockIcon } from "./blockStyles";
import { PaperTextField, PLACEHOLDER_CLASS } from "./textField";

export const PAPER_RENDERER = "paper";
const ICON_FIELD = "PAPER_ICON";
/** the class of a built-in block's symbol */
const SYMBOL_CLASS = "paperBlockSymbol";
/** Blockly sizes block text in points */
const POINTS_PER_PIXEL = 0.75;



/** Block text: PaperUI's smallest text, a touch heavier to read on colour. */
function blockFont() {
    return { family: token("--paper-font-family"), weight: token("--paper-weight-semibold"), pixels: tokenPixels("--paper-text-size-1") };
}

/** A block's icon: as tall as its text. */
const ICON_SIZE = "--paper-icon-size-tiny";

/**
 * Waits for the fonts blocks are drawn in: Blockly measures text once, so a
 * block measured in a stand-in font keeps the stand-in's size.
 */
export async function loadBlockFonts(): Promise<void> {
    const font = blockFont();
    const loads = [
        document.fonts.load(`${font.weight} ${font.pixels}px ${font.family}`),
        document.fonts.load(`${tokenPixels(ICON_SIZE)}px ${token("--paper-icon-font-family")}`, "extension"),
    ];
    for (const faces of await Promise.all(loads)) if (faces.length === 0) throw new Error("PaperUI's fonts aren't on this page");
}

/** PaperUI's colours and font, as a Blockly theme. */
export function paperTheme(): Blockly.Theme {
    const font = blockFont();
    return Blockly.Theme.defineTheme("paper", {
        name: "paper",
        blockStyles: blockStyles(),
        // the Actions canvas: the app's surface, dotted (the grid, in App.tsx)
        componentStyles: {
            workspaceBackgroundColour: token("--paper-surface-app"),
            scrollbarColour: token("--paper-border-strong"),
            insertionMarkerColour: token("--paper-text"),
        },
        fontStyle: { family: font.family, weight: font.weight, size: font.pixels * POINTS_PER_PIXEL },
        // a block that starts a flow is flat on top, with nothing to stack under
        startHats: false,
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
        const size = tokenPixels(ICON_SIZE);
        this.size_ = new Blockly.utils.Size(size, size);
        this.textElement_!.setAttribute("x", "0");
        this.textElement_!.setAttribute("y", String(size / 2));
        this.textElement_!.setAttribute("dominant-baseline", "central");
    }
}

function iconField(icon: BlockIcon): Blockly.Field {
    if ("symbol" in icon) return new SymbolField(icon.symbol);
    const size = tokenPixels(ICON_SIZE);
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
        // zelos measures in grid units: a sixth of PaperUI's gap, so its
        // padding, notches and heights follow the gap, at half Scratch's size
        super(tokenPixels("--paper-uigap") / 6);
        // every corner is PaperUI's small radius, as its inputs and menu items
        // are; it's also the least a block's top and bottom rows are
        this.CORNER_RADIUS = tokenPixels("--paper-border-radius-half");
        this.TOP_ROW_MIN_HEIGHT = this.CORNER_RADIUS;
        this.BOTTOM_ROW_MIN_HEIGHT = this.CORNER_RADIUS;
        this.FIELD_BORDER_RECT_RADIUS = this.CORNER_RADIUS;
        // a dropdown opens as PaperUI's menu, not in its block's colour
        this.FIELD_DROPDOWN_COLOURED_DIV = false;
    }

    /** The colours read from the page: again on every theme change, so light and dark follow the app. */
    override setDynamicProperties_(theme: Blockly.Theme): void {
        super.setDynamicProperties_(theme);
        this.SELECTED_GLOW_COLOUR = token("--paper-primary");
        // a value typed into a socket: PaperUI's text field
        this.FIELD_BORDER_RECT_COLOUR = token("--paper-field");
    }

    /** A value is a rounded rectangle, as every other edge is, not Scratch's pill. */
    override makeRounded(): ReturnType<Blockly.zelos.ConstantProvider["makeRounded"]> {
        return { ...this.makeSquared(), type: this.SHAPES["ROUND"]! } as ReturnType<Blockly.zelos.ConstantProvider["makeRounded"]>;
    }

    // Blockly's renderer CSS, with PaperUI's colours where zelos has Scratch's
    override getCSS_(selector: string): string[] {
        const font = `${this.FIELD_TEXT_FONTWEIGHT} ${this.FIELD_TEXT_FONTSIZE}pt ${this.FIELD_TEXT_FONTFAMILY}`;
        const fieldText = [">text", ">g>text"].flatMap((child) => [`${selector} .blocklyNonEditableField${child}`, `${selector} .blocklyEditableField${child}`]).join(",");
        return [
            `${selector} .blocklyText, ${selector} .blocklyFlyoutLabelText { font: ${font}; }`,
            `${selector} .blocklyTextInputBubble textarea { font-weight: ${getVarCss("weight-regular")}; }`,
            `${selector} .blocklyText { fill: ${getVarCss("on-color")}; }`,
            `${selector} .${SYMBOL_CLASS} { font-family: ${getVarCss("icon-font-family")}; font-size: ${getVarCss("icon-size-tiny")}; font-weight: ${getVarCss("weight-regular")}; font-variation-settings: "FILL" 1, "wght" 500, "GRAD" 0, "opsz" 14; }`,
            // a field you type into, as PaperUI's input
            `${selector} .blocklyNonEditableField>rect:not(.blocklyDropdownRect), ${selector} .blocklyEditableField>rect:not(.blocklyDropdownRect) { fill: ${getVarCss("field")}; }`,
            `${fieldText} { fill: ${getVarCss("text")}; }`,
            // an empty field says what goes in it, as PaperUI's placeholders do
            `${selector} .${PLACEHOLDER_CLASS} { fill: ${getVarCss("text-faint")} !important; font-weight: ${getVarCss("weight-regular")}; }`,
            // a typed-in value (a shadow that's only its text field) is PaperUI's field. Blockly paints it
            // with the colour it had when the field was first drawn, so the theme is followed here instead
            `${selector} .blocklyShadow:has(> .blocklyEditableField > text:not(.blocklyDropdownText)) > .blocklyPath { fill: ${getVarCss("field")}; }`,
            // every block and every field has an edge, so each reads apart from what it sits on
            `${selector} .blocklyPath { stroke-width: ${getVarCss("border-width")}; }`,
            `${selector} .blocklyShadow>.blocklyPath, ${selector} .blocklyNonEditableField>rect:not(.blocklyDropdownRect), ${selector} .blocklyEditableField>rect:not(.blocklyDropdownRect) { stroke: ${getVarCss("border-strong")}; stroke-width: ${getVarCss("border-width")}; }`,
            `${selector} .blocklyFlyoutLabelText { fill: ${getVarCss("text-subtle")}; }`,
            `${selector} .blocklyText.blocklyBubbleText { fill: ${getVarCss("text")}; }`,
            `${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>rect, ${selector} .blocklyDraggable:not(.blocklyDisabled) .blocklyEditableField:not(.blocklyEditing):hover>.blocklyPath { stroke: ${getVarCss("primary")}; stroke-width: ${getVarCss("thick-border-width")}; }`,
            `${selector} .blocklyHtmlInput { font-family: ${this.FIELD_TEXT_FONTFAMILY}; font-weight: ${this.FIELD_TEXT_FONTWEIGHT}; color: ${getVarCss("text")}; background: ${getVarCss("field")}; }`,
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
        for (const input of block.inputList) for (const field of input.fieldRow) if (field instanceof PaperTextField) field.refreshPlaceholder();
        super.render(block);
    }
}

Blockly.blockRendering.register(PAPER_RENDERER, PaperRenderer);
