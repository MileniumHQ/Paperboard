// DOM helpers for the action editor's inline variable chips. Kept out of the
// Solid components so the caret contract (insert a chip, keep typing next to
// it) can be exercised against a real browser in the panel tests.
import { getVariableInfo } from "./variableTypes";

export interface VariableChip {
    varId: string;
    label: string;
    icon: string;
}

/** Serializes a stored value (with {{id:label:icon}} refs) to chip markup. */
export function renderHtmlWithChips(text: string): string {
    if (!text) return "";
    return text.replace(/\{\{([^{}]+)\}\}/g, (_match, token) => {
        const info = getVariableInfo(token);
        const varId = token.split(":")[0];
        return `\u200B<span class="actionVariableChip" contenteditable="false" data-var-id="${varId}" data-label="${info.label}" data-icon="${info.icon}"><span class="chipIcon">${info.icon}</span><span class="chipLabel">${info.label}</span></span>\u200B`;
    });
}

/** Reads the stored value back out of the editable DOM. Single-line fields
 * collapse a newline to a space; multiline fields keep the line break. */
export function extractTextWithVariables(
    element: HTMLElement,
    preserveNewlines = false,
): string {
    let result = "";
    for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            result += (node.textContent || "").replace(/[\u200B\uFEFF]/g, "");
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.classList.contains("actionVariableChip")) {
                const varId = el.getAttribute("data-var-id") || "output";
                const label = el.getAttribute("data-label") || varId;
                const icon = el.getAttribute("data-icon") || "";
                result += `{{${varId}:${label}:${icon}}}`;
            } else if (el.tagName === "BR") {
                // browsers can insert breaks on their own; treat them as
                // line breaks so a multiline value never loses a line
                result += preserveNewlines ? "\n" : " ";
            } else {
                result += (el.textContent || "").replace(/[\u200B\uFEFF]/g, "");
            }
        }
    }
    if (preserveNewlines) return result.trim();
    return result.replace(/\s*\n\s*/g, " ").trim();
}

function createVariableChip(chip: VariableChip): HTMLSpanElement {
    const node = document.createElement("span");
    node.className = "actionVariableChip";
    node.contentEditable = "false";
    node.setAttribute("data-var-id", chip.varId);
    node.setAttribute("data-label", chip.label);
    node.setAttribute("data-icon", chip.icon);
    node.innerHTML = `<span class="chipIcon">${chip.icon}</span><span class="chipLabel">${chip.label}</span>`;
    return node;
}

/** Moves the caret to the end of the element's content. */
export function placeCaretAtEnd(element: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection) return;
    element.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Replaces `range`'s content with the chip and leaves the caret directly
 * after it, separated by a zero-width anchor so a boundary chip still has a
 * text node to sit next to.
 */
export function insertVariableChip(
    element: HTMLElement,
    range: Range,
    chip: VariableChip,
): void {
    element.focus({ preventScroll: true });
    range.deleteContents();

    const leading = document.createTextNode("\u200B");
    range.insertNode(leading);
    range.setStartAfter(leading);

    const node = createVariableChip(chip);
    range.insertNode(node);

    const trailing = document.createTextNode("\u200B");
    node.after(trailing);

    const selection = window.getSelection();
    if (selection) {
        const after = document.createRange();
        after.setStart(trailing, 1);
        after.collapse(true);
        selection.removeAllRanges();
        selection.addRange(after);
    }
}

/** Appends a chip when no caret range exists, leaving the caret after it. */
export function appendVariableChip(
    element: HTMLElement,
    chip: VariableChip,
): void {
    element.appendChild(document.createTextNode("\u200B"));
    element.appendChild(createVariableChip(chip));
    element.appendChild(document.createTextNode("\u200B"));
    placeCaretAtEnd(element);
}

function isZeroWidthOnlyText(node: Node | null): node is Text {
    return (
        node !== null &&
        node.nodeType === Node.TEXT_NODE &&
        (node.textContent || "").replace(/[\u200B\uFEFF]/g, "") === ""
    );
}

function isChip(node: Node | null): node is HTMLElement {
    return (
        node !== null &&
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).classList.contains("actionVariableChip")
    );
}

/**
 * Deletes a chip together with the zero-width anchors around it, leaving
 * the caret at the seam where the chip was. Removing only the chip used to
 * strand the invisible anchors in the DOM, so the next Backspace/Delete
 * presses were spent deleting characters the user cannot see.
 */
export function removeVariableChip(element: HTMLElement, chip: HTMLElement): void {
    let preceding = chip.previousSibling;
    while (isZeroWidthOnlyText(preceding)) {
        const doomed = preceding;
        preceding = preceding.previousSibling;
        doomed.remove();
    }
    let following = chip.nextSibling;
    while (isZeroWidthOnlyText(following)) {
        const doomed = following;
        following = following.nextSibling;
        doomed.remove();
    }

    const precedingText =
        preceding?.nodeType === Node.TEXT_NODE ? preceding.textContent || "" : "";
    chip.remove();

    let caretNode: Node | null = null;
    let caretOffset = 0;
    if (preceding && following && preceding.nodeType === Node.TEXT_NODE && following.nodeType === Node.TEXT_NODE) {
        // merge the two halves so the seam is one caret position, not two
        (preceding as Text).textContent =
            precedingText + (following.textContent || "");
        following.remove();
        caretNode = preceding;
        caretOffset = precedingText.length;
    } else if (preceding && preceding.nodeType === Node.TEXT_NODE) {
        caretNode = preceding;
        caretOffset = (preceding.textContent || "").length;
    } else if (following && following.nodeType === Node.TEXT_NODE) {
        caretNode = following;
        caretOffset = 0;
    }

    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    if (caretNode) {
        range.setStart(caretNode, caretOffset);
    } else {
        range.selectNodeContents(element);
        range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

// the visible sibling a collapsed caret would delete across, skipping the
// zero-width anchors; null when the keystroke has real text to delete
function visibleNeighbour(
    element: HTMLElement,
    node: Node,
    offset: number,
    direction: "backward" | "forward",
): Node | null {
    const atEdge =
        direction === "backward"
            ? node.nodeType === Node.TEXT_NODE
                ? (node.textContent || "").slice(0, offset).replace(/[\u200B\uFEFF]/g, "") === ""
                : node === element
                  ? offset > 0
                  : false
            : node.nodeType === Node.TEXT_NODE
              ? (node.textContent || "").slice(offset).replace(/[\u200B\uFEFF]/g, "") === ""
              : node === element
                ? offset < element.childNodes.length
                : false;
    if (!atEdge) return null;
    let neighbour =
        node === element
            ? direction === "backward"
                ? element.childNodes[offset - 1] ?? null
                : element.childNodes[offset] ?? null
            : direction === "backward"
              ? node.previousSibling
              : node.nextSibling;
    while (isZeroWidthOnlyText(neighbour)) {
        neighbour =
            direction === "backward" ? neighbour.previousSibling : neighbour.nextSibling;
    }
    return neighbour;
}

/**
 * Removes zero-width anchors that no chip needs anymore. The chip-around
 * anchors exist only so a caret can sit next to a chip; when the last chip
 * is gone (for example the browser deleted a mouse-selected chip) their
 * leftovers would otherwise cost the user invisible Backspace presses
 * before reaching real text. The caret is kept by visible offset.
 */
export function pruneStrandedAnchors(element: HTMLElement): void {
    if (element.querySelector(".actionVariableChip")) return;
    const zeros = Array.from(element.childNodes).filter(isZeroWidthOnlyText);
    if (zeros.length === 0) return;

    const selection = window.getSelection();
    let caretOffset: number | null = null;
    if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (element.contains(range.startContainer) && range.collapsed) {
            const probe = document.createRange();
            probe.selectNodeContents(element);
            probe.setEnd(range.startContainer, range.startOffset);
            caretOffset = (probe.toString() || "")
                .replace(/[\u200B\uFEFF]/g, "").length;
        }
    }

    for (const node of zeros) node.remove();

    if (caretOffset === null || !selection) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = caretOffset;
    let node = walker.nextNode();
    while (node) {
        const length = (node.textContent || "").length;
        if (remaining <= length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        remaining -= length;
        node = walker.nextNode();
    }
    placeCaretAtEnd(element);
}

/**
 * True when the collapsed caret sits beside a variable chip in the given
 * direction. The chip (and its anchors) is removed and the caret placed at
 * the seam; the caller must then preventDefault the keystroke.
 */
export function deleteVariableChip(
    element: HTMLElement,
    key: "Backspace" | "Delete",
): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !element.contains(range.startContainer)) return false;
    const target = visibleNeighbour(
        element,
        range.startContainer,
        range.startOffset,
        key === "Backspace" ? "backward" : "forward",
    );
    if (!isChip(target)) return false;
    removeVariableChip(element, target);
    return true;
}

/**
 * Writes a committed value back to the editable DOM. While the element has
 * focus its DOM already IS the display (chips included), so rebuilding it
 * would detach the selection nodes and throw the caret to the start of the
 * element. `force` is for cases that genuinely normalize the content (an
 * incomplete number); the caller then re-places the caret.
 */
export function commitEditableDom(
    element: HTMLElement,
    display: string,
    options: { focused: boolean; force?: boolean },
): void {
    if (!options.force && options.focused) return;
    element.innerHTML = display ? renderHtmlWithChips(display) : "";
}
