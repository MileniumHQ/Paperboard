// Blockly draws its tooltips in a box of its own; the editor shows the
// system's instead, as the rest of the app does. Whatever Blockly would show
// under the pointer becomes the title of the element it's bound to, read
// fresh each time, since a block's tooltip can change with what's in it.
// Editor.module.css hides Blockly's box.
import * as Blockly from "blockly";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The element Blockly binds a tooltip to: itself or the nearest one above it under `host`. */
function tooltipElement(target: EventTarget | null, host: Element): Element | null {
    let el = target instanceof Element ? target : null;
    while (el && el !== host) {
        if ("tooltip" in el && (el as { tooltip?: unknown }).tooltip != null) return el;
        el = el.parentElement;
    }
    return null;
}

function setTitle(el: Element, text: string): void {
    if (!(el instanceof SVGElement)) {
        if (text) el.setAttribute("title", text);
        else el.removeAttribute("title");
        return;
    }
    // an SVG element's title is its first <title> child
    let title = Array.from(el.children).find((c) => c.localName === "title") ?? null;
    if (!text) {
        title?.remove();
        return;
    }
    if (!title) {
        title = document.createElementNS(SVG_NS, "title");
        el.prepend(title);
    }
    if (title.textContent !== text) title.textContent = text;
}

/** Shows Blockly's tooltips under `host` as the system's; returns what stops it. */
export function nativeTooltips(host: HTMLElement): () => void {
    const over = (event: PointerEvent) => {
        const el = tooltipElement(event.target, host);
        if (el) setTitle(el, Blockly.Tooltip.getTooltipOfObject(el));
    };
    host.addEventListener("pointerover", over, true);
    return () => host.removeEventListener("pointerover", over, true);
}
