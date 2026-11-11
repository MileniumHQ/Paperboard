// A section heading in the Library's list, as the Actions library drew one:
// the section's symbol, its name, and a badge with how many blocks it has.
// Blockly's flyout lays out SVG, so this is Blockly's label with the symbol
// and the badge drawn beside its text, measured in PaperUI's tokens.
import * as Blockly from "blockly";
import { token, tokenPixels } from "./tokens";

/** The toolbox kind of a heading. */
export const HEADING_KIND = "heading";

export interface HeadingInfo {
    kind: typeof HEADING_KIND;
    text: string;
    /** a Material Symbols name, or a picture (a panel's icon) */
    icon: { symbol: string } | { src: string };
    count: number;
    /** the class of each part, from the page's CSS module */
    classes: { heading: string; icon: string; badge: string; badgeText: string };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, parent: SVGElement): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.appendChild(element);
    return element;
}

/** Blockly's label, its parts reached at run time: they're private to its type. */
interface LabelParts {
    svgGroup: SVGGElement;
    svgText: SVGTextElement;
    width: number;
    height: number;
}

class Heading extends Blockly.FlyoutButton {
    constructor(workspace: Blockly.WorkspaceSvg, target: Blockly.WorkspaceSvg, info: HeadingInfo) {
        // Blockly reads "web-class" for a label's class, though its type doesn't name it
        super(workspace, target, { kind: "label", text: info.text, id: undefined, "web-class": info.classes.heading } as Blockly.utils.toolbox.LabelInfo, true);
        const parts = this as unknown as LabelParts;
        const gap = tokenPixels("--paper-uigap") / 2;
        const quarter = tokenPixels("--paper-uigap") / 4;
        const border = tokenPixels("--paper-border-width");
        const radius = tokenPixels("--paper-border-radius-half");
        const iconSize = tokenPixels("--paper-icon-size-medium");
        const family = token("--paper-font-family");
        const textSize = tokenPixels("--paper-text-size-2");
        const badgeSize = textSize * 0.88;
        const weight = token("--paper-weight-bold");

        const name = parts.svgText;
        const nameWidth = Blockly.utils.dom.getFastTextWidthWithSizeString(name, `${textSize}px`, weight, family);
        const height = Math.max(iconSize, textSize + 2 * quarter + 2 * border);
        const middle = height / 2;

        if ("symbol" in info.icon) {
            const icon = svg("text", { class: info.classes.icon, x: 0, y: middle, "dominant-baseline": "central", "aria-hidden": "true" }, parts.svgGroup);
            icon.textContent = info.icon.symbol;
        } else {
            svg("image", { href: info.icon.src, x: 0, y: middle - iconSize / 2, width: iconSize, height: iconSize, "aria-hidden": "true" }, parts.svgGroup);
        }

        name.setAttribute("text-anchor", "start");
        name.setAttribute("x", String(iconSize + gap));
        name.setAttribute("y", String(middle));
        name.setAttribute("dominant-baseline", "central");

        const badgeX = iconSize + gap + nameWidth + gap;
        const badge = svg("rect", { class: info.classes.badge, x: badgeX, rx: radius, ry: radius }, parts.svgGroup);
        const count = svg("text", { class: info.classes.badgeText, y: middle, "dominant-baseline": "central", "text-anchor": "middle" }, parts.svgGroup);
        count.textContent = String(info.count);
        const countWidth = Blockly.utils.dom.getFastTextWidthWithSizeString(count, `${badgeSize}px`, weight, family);
        const badgeWidth = countWidth + 2 * gap + 2 * border;
        const badgeHeight = badgeSize * 1.2 + 2 * quarter + 2 * border;
        badge.setAttribute("width", String(badgeWidth));
        badge.setAttribute("height", String(badgeHeight));
        badge.setAttribute("y", String(middle - badgeHeight / 2));
        count.setAttribute("x", String(badgeX + badgeWidth / 2));

        parts.width = badgeX + badgeWidth;
        parts.height = height;
        const background = parts.svgGroup.querySelector("rect");
        background?.setAttribute("width", String(parts.width));
        background?.setAttribute("height", String(parts.height));
    }
}

class HeadingInflater implements Blockly.IFlyoutInflater {
    load(state: object, flyout: Blockly.IFlyout): Blockly.FlyoutItem {
        const heading = new Heading(flyout.getWorkspace(), flyout.targetWorkspace!, state as HeadingInfo);
        heading.show();
        return new Blockly.FlyoutItem(heading, HEADING_KIND);
    }

    gapForItem(_state: object, defaultGap: number): number {
        return defaultGap;
    }

    disposeItem(item: Blockly.FlyoutItem): void {
        const element = item.getElement();
        if (element instanceof Heading) element.dispose();
    }

    getType(): string {
        return HEADING_KIND;
    }
}

if (!Blockly.registry.hasItem(Blockly.registry.Type.FLYOUT_INFLATER, HEADING_KIND)) Blockly.registry.register(Blockly.registry.Type.FLYOUT_INFLATER, HEADING_KIND, HeadingInflater);
