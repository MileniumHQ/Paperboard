import { createSignal, createMemo, createEffect, onMount, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperText,
    PaperButton,
    PaperSelectMenu,
    PaperSelectMenuItem,
} from "@paperboard-dev/paperui";
import type { ActionSchema, TriggerSchema } from "@paperboard-dev/paperapi";
import type { CanvasBlock } from "../lib/tree";
import { plainTextFromClipboard, sanitizeNumberText } from "../lib/textInput";

export interface ActionBlockProps {
    id?: string;
    action: ActionSchema | TriggerSchema;
    isTrigger?: boolean;
    pos?: { x: number; y: number };
    zIndex?: number;
    values?: Record<string, any>;
    children?: CanvasBlock[];
    elseChildren?: CanvasBlock[];
    activeDropTarget?: { parentId: string; insertIndex: number } | null;
    onValueChange?: (blockId: string, key: string, value: any) => void;
    onMove?: (newPos: { x: number; y: number }, clientX?: number, clientY?: number) => void;
    onDragEnd?: () => void;
    onInteract?: () => void;
    onContextMenu?: (
        blockId: string,
        clientX: number,
        clientY: number,
        e: MouseEvent,
    ) => void;
    onStartDragChild?: (
        child: CanvasBlock,
        grabOffset: { x: number; y: number },
        e: PointerEvent,
    ) => void;
    onRequestVariablePicker?: (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        isArray?: boolean,
    ) => void;
    onRequestOptionPicker?: (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        options: { label: string; value: any; icon?: string }[],
        selectedValue: any,
        onSelect: (value: any) => void,
    ) => void;
    variableName?: string | null;
    activeTargetBlockId?: () => string | null;
    highlightedSourceBlockId?: () => string | null;
    isVariablePickerOpen?: () => boolean;
    iconSrc?: string;
    class?: string;
    static?: boolean;
    running?: boolean;
    runningBlockIds?: () => Set<string>;
}

interface TemplateToken {
    type: "text" | "input";
    text?: string;
    key?: string;
    label?: string;
}

function formatFallbackLabel(key: string): string {
    if (!key) return "";
    return key.charAt(0).toUpperCase() + key.slice(1);
}

// non-primitive types are variable-only, no keyboard entry
const PRIMITIVE_INPUT_TYPES = new Set([
    "string",
    "number",
    "boolean",
    "object",
    "any",
    "file",
    "void",
    "select",
    "url",
    "color",
]);

function isArrayInputType(t?: string): boolean {
    if (!t) return false;
    return t === "array" || t.startsWith("list<") || t.startsWith("array<");
}

function innerTypeOf(t: string): string {
    const m = t.match(/^(?:list|array)<(.+)>$/);
    return m ? m[1] : t;
}

function isTypedOnlyInput(def: any): boolean {
    if (!def?.type) return false;
    if (def.options && def.options.length > 0) return false;
    if (def.type === "boolean") return false;
    if (isArrayInputType(def.type)) {
        const inner = innerTypeOf(def.type);
        if (inner === "array") return false;
        return !PRIMITIVE_INPUT_TYPES.has(inner);
    }
    return !PRIMITIVE_INPUT_TYPES.has(def.type);
}

function expectedTypeOf(def: any): string {
    if (!def?.type) return "any";
    if (isArrayInputType(def.type)) {
        const inner = innerTypeOf(def.type);
        return inner === "array" ? "any" : inner;
    }
    return def.type;
}

const FRIENDLY_TYPE_NAMES: Record<string, string> = {
    string: "Text",
    number: "Number",
    boolean: "Boolean",
    object: "Object",
    any: "Any",
    url: "URL",
    color: "Color",
    "discord-channel": "Channel",
    "discord-user": "User",
    "discord-message": "Message",
    "discord-embed": "Embed",
};

function friendlyTypeName(t?: string): string {
    if (!t) return "Any";
    if (isArrayInputType(t)) {
        const inner = innerTypeOf(t);
        if (inner === "array") return "Any[]";
        return `${FRIENDLY_TYPE_NAMES[inner] || inner.charAt(0).toUpperCase() + inner.slice(1)}[]`;
    }
    return FRIENDLY_TYPE_NAMES[t] || t.charAt(0).toUpperCase() + t.slice(1);
}

function parseTemplateTokens(
    template: string | undefined,
    name: string,
    params: Record<string, any> = {},
): TemplateToken[] {
    if (!template) {
        const tokens: TemplateToken[] = [{ type: "text", text: name }];
        const paramKeys = Object.keys(params);
        if (paramKeys.length > 0) {
            tokens.push({ type: "text", text: " " });
            for (let i = 0; i < paramKeys.length; i++) {
                const k = paramKeys[i];
                tokens.push({
                    type: "input",
                    key: k,
                    label: params[k]?.label || formatFallbackLabel(k),
                });
                if (i < paramKeys.length - 1) {
                    tokens.push({ type: "text", text: " " });
                }
            }
        }
        return tokens;
    }

    const tokens: TemplateToken[] = [];
    const regex = /\{([a-zA-Z0-9_-]+)\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(template)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({
                type: "text",
                text: template.slice(lastIndex, match.index),
            });
        }
        const key = match[1];
        tokens.push({
            type: "input",
            key,
            label: params[key]?.label || formatFallbackLabel(key),
        });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < template.length) {
        tokens.push({
            type: "text",
            text: template.slice(lastIndex),
        });
    }

    return tokens;
}

interface ActionEditableFieldProps {
    blockId?: string;
    paramKey: string;
    isNumber?: boolean;
    multiline?: boolean;
    inputMode?: string;
    spellcheck?: boolean;
    initialValue?: any;
    placeholder?: string;
    isTrigger?: boolean;
    isRequired?: boolean;
    disabled?: boolean;
    onCommit?: (val: any) => void;
    onRequestVariablePicker?: (
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
    ) => void;
}

function getVariableInfo(token: string): { label: string; icon: string } {
    const raw = token.replace(/[\{\}]/g, "").trim();
    const parts = raw.split(":");
    const varId = parts[0].toLowerCase();
    const label =
        parts[1] ||
        (varId === "player"
            ? "Username"
            : varId === "message"
              ? "Message"
              : varId === "output"
                ? "Result"
                : formatFallbackLabel(varId));
    let icon = parts[2];
    if (!icon) {
        if (varId === "player" || varId.includes("user")) icon = "person_add";
        else if (varId === "message" || varId.includes("chat")) icon = "chat";
        else if (varId === "output" || varId.includes("result") || varId.includes("command")) icon = "terminal";
        else icon = "bolt";
    }
    return { label, icon };
}

function renderHtmlWithChips(text: string): string {
    if (!text) return "";
    return text.replace(/\{\{([^{}]+)\}\}/g, (_match, token) => {
        const info = getVariableInfo(token);
        const varId = token.split(":")[0];
        return `\u200B<span class="actionVariableChip" contenteditable="false" data-var-id="${varId}" data-label="${info.label}" data-icon="${info.icon}"><span class="chipIcon">${info.icon}</span><span class="chipLabel">${info.label}</span></span>\u200B`;
    });
}

function extractTextWithVariables(element: HTMLElement, preserveNewlines = false): string {
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
            } else {
                result += (el.textContent || "").replace(/[\u200B\uFEFF]/g, "");
            }
        }
    }
    return preserveNewlines ? result.trim() : result.replace(/\n/g, "").trim();
}

// contenteditable accepts rich HTML on paste by default; this panel only
// ever stores text (plus its own chip markup), so paste is reduced to the
// clipboard's plain text before it can enter the DOM
function insertPlainTextAtCaret(element: HTMLElement, text: string): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

// a chip or a text node with visible characters; the zero-width anchors and
// whitespace-only nodes between chips are not content edges
function isVisibleContentNode(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent || "").replace(/[\u200B\uFEFF]/g, "").length > 0;
    }
    return (
        (node as HTMLElement).classList?.contains("actionVariableChip") === true
    );
}

function nodeRect(node: Node): DOMRect {
    if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as Element).getBoundingClientRect();
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
}

function placeCaret(
    element: HTMLElement,
    position: "before" | "after",
    node: Node,
): void {
    const selection = window.getSelection();
    if (!selection) return;
    element.focus({ preventScroll: true });
    const range = document.createRange();
    if (position === "before") range.setStartBefore(node);
    else range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

function ActionEditableField(fieldProps: ActionEditableFieldProps) {
    let spanRef: HTMLSpanElement | undefined;
    let savedRange: Range | null = null;
    let lastCommittedVal = fieldProps.initialValue;

    const [currentText, setCurrentText] = createSignal(
        fieldProps.initialValue !== undefined && fieldProps.initialValue !== null
            ? String(fieldProps.initialValue).trim()
            : "",
    );

    const hasContent = () => currentText().trim() !== "";

    const isColorless = () =>
        !hasContent() && (fieldProps.isTrigger || !fieldProps.isRequired || fieldProps.disabled);

    const isRequiredError = () =>
        !hasContent() && Boolean(fieldProps.isRequired) && !fieldProps.isTrigger && !fieldProps.disabled;

    const saveCurrentRange = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && spanRef && spanRef.contains(sel.anchorNode)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    };

    const insertChipAtCursor = (varId: string, label: string, icon: string) => {
        if (!spanRef) return;
        spanRef.focus({ preventScroll: true });

        const sel = window.getSelection();
        let range: Range | null = savedRange;

        if (!range || !spanRef.contains(range.startContainer)) {
            if (sel && sel.rangeCount > 0 && spanRef.contains(sel.anchorNode)) {
                range = sel.getRangeAt(0);
            }
        }

        if (range) {
            const node = range.startContainer;
            if (node && node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent || "";
                const offset = range.startOffset;
                if (offset > 0 && text[offset - 1] === "@") {
                    node.textContent = text.slice(0, offset - 1) + text.slice(offset);
                    range.setStart(node, offset - 1);
                    range.setEnd(node, offset - 1);
                }
            }

            const chip = document.createElement("span");
            chip.className = "actionVariableChip";
            chip.contentEditable = "false";
            chip.setAttribute("data-var-id", varId);
            chip.setAttribute("data-label", label);
            chip.setAttribute("data-icon", icon);
            chip.innerHTML = `<span class="chipIcon">${icon}</span><span class="chipLabel">${label}</span>`;

            range.deleteContents();

            const leading = document.createTextNode("\u200B");
            range.insertNode(leading);
            range.setStartAfter(leading);

            range.insertNode(chip);

            const trailing = document.createTextNode("\u200B");
            chip.after(trailing);

            range.setStart(trailing, 1);
            range.setEnd(trailing, 1);
            sel?.removeAllRanges();
            sel?.addRange(range);
        } else {
            const chipHtml = `\u200B<span class="actionVariableChip" contenteditable="false" data-var-id="${varId}" data-label="${label}" data-icon="${icon}"><span class="chipIcon">${icon}</span><span class="chipLabel">${label}</span></span>\u200B`;
            spanRef.innerHTML += chipHtml;
        }

        savedRange = null;
        handleCommit();
    };

    const openPicker = () => {
        if (!spanRef || fieldProps.disabled) return;
        saveCurrentRange();
        const rect = spanRef.getBoundingClientRect();
        fieldProps.onRequestVariablePicker?.(
            Math.round(rect.left),
            Math.round(rect.bottom + 4),
            (varId, label, icon) => {
                insertChipAtCursor(varId, label, icon);
            },
        );
    };

    const handleInput = (e: InputEvent) => {
        if (!spanRef) return;
        saveCurrentRange();
        let text = spanRef.innerText || "";

        // beforeinput covers typing; paste, drop and IME can still slip
        // non-numeric text in, so the value is re-sanitized here too
        if (fieldProps.isNumber && !spanRef.querySelector(".actionVariableChip")) {
            const sanitized = sanitizeNumberText(text);
            if (sanitized !== text) {
                spanRef.textContent = sanitized;
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(spanRef);
                range.collapse(false);
                selection?.removeAllRanges();
                selection?.addRange(range);
                text = sanitized;
            }
        }

        setCurrentText(text);

        if (text.includes("@") || e.data === "@") {
            openPicker();
        }
    };

    const handleCommit = () => {
        if (!spanRef) return;
        const clean = extractTextWithVariables(spanRef, fieldProps.multiline);
        let parsed: any = clean;

        if (fieldProps.isNumber) {
            if (clean.includes("{{")) {
                // a variable reference, not a literal number
                parsed = clean;
            } else if (clean === "") {
                parsed = undefined;
            } else if (!Number.isFinite(Number(clean))) {
                // an incomplete edit like "-" or ".": restore the last valid
                // value instead of committing NaN
                const restored =
                    lastCommittedVal !== undefined && lastCommittedVal !== null
                        ? String(lastCommittedVal)
                        : "";
                spanRef.innerHTML = restored ? renderHtmlWithChips(restored) : "";
                setCurrentText(restored);
                parsed = lastCommittedVal;
            } else {
                parsed = Number(clean);
            }
        }

        const display =
            parsed === undefined || parsed === null ? "" : String(parsed);
        lastCommittedVal = parsed;
        setCurrentText(display);
        spanRef.innerHTML = display ? renderHtmlWithChips(display) : "";
        fieldProps.onCommit?.(parsed);
    };

    const handlePaste = (e: ClipboardEvent) => {
        if (fieldProps.disabled || !spanRef) return;
        e.preventDefault();
        let text = plainTextFromClipboard(
            e.clipboardData?.getData("text/plain"),
            Boolean(fieldProps.multiline),
        );
        if (fieldProps.isNumber) text = sanitizeNumberText(text);
        if (!text) return;
        insertPlainTextAtCaret(spanRef, text);
        saveCurrentRange();
        handleCommit();
    };

    onMount(() => {
        if (spanRef) {
            const val = fieldProps.initialValue;
            if (val !== undefined && val !== null && String(val).trim() !== "") {
                spanRef.innerHTML = renderHtmlWithChips(String(val));
                setCurrentText(String(val));
            } else {
                spanRef.innerHTML = "";
                setCurrentText("");
            }
        }
    });

    createEffect(() => {
        const val = fieldProps.initialValue;
        if (val !== lastCommittedVal) {
            lastCommittedVal = val;
            setCurrentText(String(val || ""));
            if (spanRef && document.activeElement !== spanRef) {
                if (val !== undefined && val !== null && String(val).trim() !== "") {
                    spanRef.innerHTML = renderHtmlWithChips(String(val));
                } else {
                    spanRef.innerHTML = "";
                }
            }
        }
    });

    return (
        <span
            ref={spanRef}
            contenteditable={!fieldProps.disabled}
            class={`actionInput actionEditable ${fieldProps.multiline ? "actionEditableMultiline" : ""} ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
            data-placeholder={fieldProps.placeholder}
            inputmode={fieldProps.inputMode as "url" | undefined}
            spellcheck={fieldProps.spellcheck}
            onPointerDown={(e) => {
                e.stopPropagation();
            }}
            onClick={(e) => {
                e.stopPropagation();
                if (!spanRef || fieldProps.disabled) return;
                const chip = (e.target as HTMLElement).closest?.(
                    ".actionVariableChip",
                ) as HTMLElement | null;
                if (chip) {
                    // double-click replaces the variable, single click just
                    // places the caret on the side you clicked so you can
                    // keep typing next to it
                    if (e.detail >= 2) {
                        saveCurrentRange();
                        openPicker();
                        return;
                    }
                    const rect = chip.getBoundingClientRect();
                    placeCaret(
                        spanRef,
                        e.clientX < rect.left + rect.width / 2 ? "before" : "after",
                        chip,
                    );
                    saveCurrentRange();
                    return;
                }
                // clicking the padding before/after the content lands the
                // caret on the correct side of a boundary chip
                const content = Array.from(spanRef.childNodes).filter(
                    isVisibleContentNode,
                );
                const first = content[0];
                const last = content[content.length - 1];
                if (first && last) {
                    const firstRect = nodeRect(first);
                    const lastRect = nodeRect(last);
                    if (e.clientX < firstRect.left) {
                        placeCaret(spanRef, "before", first);
                    } else if (e.clientX > lastRect.right) {
                        placeCaret(spanRef, "after", last);
                    }
                }
                saveCurrentRange();
            }}
            onKeyUp={saveCurrentRange}
            onMouseUp={saveCurrentRange}
            onInput={handleInput}
            onPaste={handlePaste}
            onBeforeInput={(e) => {
                if (!fieldProps.isNumber || fieldProps.disabled || !spanRef) return;
                const data = (e as InputEvent).data;
                if (data === null || data === undefined) return;
                const current = extractTextWithVariables(spanRef, false);
                // a keystroke that sanitizes away (a letter, a second dot)
                // must never enter the field
                if (sanitizeNumberText(current + data) === current) {
                    e.preventDefault();
                }
            }}
            onBlur={handleCommit}
            onKeyDown={(e) => {
                e.stopPropagation();

                if (e.key === "Enter" && !fieldProps.multiline) {
                    e.preventDefault();
                    spanRef?.blur();
                    return;
                }
                if (e.key === "Escape") {
                    spanRef?.blur();
                    return;
                }

                if (e.key === "Backspace") {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0 && spanRef && spanRef.contains(sel.anchorNode)) {
                        const range = sel.getRangeAt(0);
                        if (range.collapsed) {
                            const node = range.startContainer;
                            const offset = range.startOffset;

                            if (node.nodeType === Node.TEXT_NODE) {
                                const textBefore = (node.textContent || "").slice(0, offset);
                                if (textBefore.replace(/[\u200B\uFEFF]/g, "") === "") {
                                    let prev = node.previousSibling;
                                    while (
                                        prev &&
                                        prev.nodeType === Node.TEXT_NODE &&
                                        (prev.textContent || "").replace(/[\u200B\uFEFF]/g, "") === ""
                                    ) {
                                        prev = prev.previousSibling;
                                    }
                                    if (prev && (prev as HTMLElement).classList?.contains("actionVariableChip")) {
                                        e.preventDefault();
                                        prev.remove();
                                        handleCommit();
                                        return;
                                    }
                                }
                            } else if (node === spanRef && offset > 0) {
                                const prev = spanRef.childNodes[offset - 1];
                                if (prev && (prev as HTMLElement).classList?.contains("actionVariableChip")) {
                                    e.preventDefault();
                                    prev.remove();
                                    handleCommit();
                                    return;
                                }
                            }
                        }
                    }
                }

                if (e.key === "Delete") {
                    const sel = window.getSelection();
                    if (sel && sel.rangeCount > 0 && spanRef && spanRef.contains(sel.anchorNode)) {
                        const range = sel.getRangeAt(0);
                        if (range.collapsed) {
                            const node = range.startContainer;
                            const offset = range.startOffset;

                            if (node.nodeType === Node.TEXT_NODE) {
                                const textAfter = (node.textContent || "").slice(offset);
                                if (textAfter.replace(/[\u200B\uFEFF]/g, "") === "") {
                                    let next = node.nextSibling;
                                    while (
                                        next &&
                                        next.nodeType === Node.TEXT_NODE &&
                                        (next.textContent || "").replace(/[\u200B\uFEFF]/g, "") === ""
                                    ) {
                                        next = next.nextSibling;
                                    }
                                    if (next && (next as HTMLElement).classList?.contains("actionVariableChip")) {
                                        e.preventDefault();
                                        next.remove();
                                        handleCommit();
                                        return;
                                    }
                                }
                            } else if (node === spanRef && offset < spanRef.childNodes.length) {
                                const next = spanRef.childNodes[offset];
                                if (next && (next as HTMLElement).classList?.contains("actionVariableChip")) {
                                    e.preventDefault();
                                    next.remove();
                                    handleCommit();
                                    return;
                                }
                            }
                        }
                    }
                }
            }}
        />
    );
}

interface TypedVariablePillProps {
    blockId?: string;
    paramKey: string;
    def: any;
    value?: any;
    placeholder: string;
    isTrigger?: boolean;
    isRequired?: boolean;
    disabled?: boolean;
    onChange?: (val: any) => void;
    onRequestVariablePicker?: (
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        isArray?: boolean,
    ) => void;
}

// variable-only pill, array variant keeps a real text cursor
function TypedVariablePill(pillProps: TypedVariablePillProps) {
    let pillRef: HTMLSpanElement | undefined;
    const isArray = () => isArrayInputType(pillProps.def?.type);
    const expectedType = () => expectedTypeOf(pillProps.def);
    const hasValue = () => {
        const v = pillProps.value;
        return v !== undefined && v !== null && String(v).trim() !== "";
    };
    const isColorless = () =>
        !hasValue() &&
        Boolean(pillProps.isTrigger || !pillProps.isRequired || pillProps.disabled);
    const isRequiredError = () =>
        !hasValue() &&
        Boolean(pillProps.isRequired) &&
        !pillProps.isTrigger &&
        !pillProps.disabled;

    const openPicker = (anchor: HTMLElement) => {
        if (pillProps.disabled) return;
        const rect = anchor.getBoundingClientRect();
        pillProps.onRequestVariablePicker?.(
            Math.round(rect.left),
            Math.round(rect.bottom + 4),
            (varId, label, icon) => {
                const chip = `{{${varId}:${label}:${icon}}}`;
                if (isArray()) {
                    const current = String(pillProps.value || "").trim();
                    const next = current ? `${current} ${chip}` : chip;
                    pillProps.onChange?.(next);
                } else {
                    pillProps.onChange?.(chip);
                }
            },
            expectedType(),
            isArray(),
        );
    };

    const placeCaretAtEnd = () => {
        const el = pillRef;
        if (!el) return;
        el.focus({ preventScroll: true });
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
    };

    const removeLastChip = () => {
        const current = String(pillProps.value || "");
        const refs = current.match(/\{\{[^}]+\}\}/g) || [];
        if (refs.length === 0) return;
        const last = refs[refs.length - 1];
        const idx = current.lastIndexOf(last);
        const next = (current.slice(0, idx) + current.slice(idx + last.length))
            .replace(/\s{2,}/g, " ")
            .trim();
        pillProps.onChange?.(next);
        requestAnimationFrame(placeCaretAtEnd);
    };

    const handlePillClick = (e: MouseEvent) => {
        e.stopPropagation();
        if (pillProps.disabled || !pillProps.blockId) return;
        openPicker(e.currentTarget as HTMLElement);
    };

    return (
        <span
            ref={pillRef}
            class={`actionInput actionVariableOnly ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
            data-placeholder={pillProps.placeholder}
            data-has-value={hasValue() ? "true" : "false"}
            data-array={isArray() ? "true" : "false"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handlePillClick}
            onPaste={(e) => e.preventDefault()}
            onBeforeInput={(e) => {
                e.preventDefault();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Backspace" || e.key === "Delete") {
                    e.preventDefault();
                    removeLastChip();
                    return;
                }
                if (
                    isArray() &&
                    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(
                        e.key,
                    )
                ) {
                    return;
                }
                e.preventDefault();
            }}
            tabIndex={pillProps.disabled ? -1 : 0}
            title={hasValue() ? "Click to change variable" : `Select ${pillProps.placeholder}`}
            spellcheck={false}
            contenteditable={isArray() && !pillProps.disabled}
            // @ts-ignore chip markup
            innerHTML={
                hasValue()
                    ? isArray()
                        // zero-width anchors give the caret places to sit between chips
                        ? renderHtmlWithChips(String(pillProps.value))
                        : renderHtmlWithChips(String(pillProps.value)).replace(
                              /[\u200B\uFEFF]/g,
                              "",
                          )
                    : ""
            }
        />
    );
}

export default function ActionBlock(props: ActionBlockProps) {
    const [isDragging, setIsDragging] = createSignal(false);
    const [showMoreOptions, setShowMoreOptions] = createSignal(false);
    let dragStart = { x: 0, y: 0 };
    let posStart = { x: 0, y: 0 };

    const paramsMap = createMemo(() => {
        const act = props.action as ActionSchema;
        const trig = props.action as TriggerSchema;
        const map: Record<string, any> = {
            ...(act?.inputs || {}),
        };
        if (trig?.output) {
            if (typeof trig.output === "string") {
                map[trig.output] = {
                    label: formatFallbackLabel(trig.output),
                    type: trig.output,
                };
                map["output"] = { label: "Output", type: trig.output };
            } else if (typeof trig.output === "object") {
                const outType = (trig.output as any).type || "output";
                map[outType] = {
                    label: (trig.output as any).label || formatFallbackLabel(outType),
                    type: outType,
                };
                map["output"] = {
                    label: (trig.output as any).label || "Output",
                    type: outType,
                };
            }
        }
        return map;
    });

    const tokens = createMemo(() => {
        const template =
            props.action.template ||
            props.action.writtenOut ||
            undefined;
        return parseTemplateTokens(template, props.action.name, paramsMap());
    });

    const handlePointerDown = (e: PointerEvent) => {
        props.onInteract?.();

        if (e.button === 2) {
            e.stopPropagation();
            return;
        }

        if (e.button !== 0 || !props.onMove || props.static) return;

        if ((e.target as HTMLElement).closest(".actionInput") || (e.target as HTMLElement).closest("button")) return;

        e.stopPropagation();
        setIsDragging(true);
        dragStart = { x: e.clientX, y: e.clientY };
        posStart = { x: props.pos?.x || 0, y: props.pos?.y || 0 };

        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging() || !props.onMove) return;
        e.stopPropagation();

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        props.onMove(
            {
                x: Math.round(posStart.x + dx),
                y: Math.round(posStart.y + dy),
            },
            e.clientX,
            e.clientY,
        );
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (isDragging()) {
            setIsDragging(false);
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch (err) {
                console.debug("[actions] pointer capture release failed:", String(err));
            }
            props.onDragEnd?.();
        }
    };

    const isContainerBlock = () =>
        props.action.id === "repeat" ||
        props.action.id === "if" ||
        props.action.id === "if-else";

    const isHoverIndex = (index: number, branch?: "else") => {
        if (!props.activeDropTarget || !props.id) return false;
        const expectedParentId = branch === "else" ? `${props.id}:else` : props.id;
        return (
            props.activeDropTarget.parentId === expectedParentId &&
            props.activeDropTarget.insertIndex === index
        );
    };

    const isRunning = () =>
        Boolean(props.running || (props.id && props.runningBlockIds?.().has(props.id)));

    const renderInputPill = (token: TemplateToken, placeholderOverride?: string) => {
        const key = token.key!;
        const def = paramsMap()[key];
        const val = () => props.values?.[key];
        const hasValue = () => {
            const v = val();
            return v !== undefined && v !== null && String(v).trim() !== "";
        };
        const isTrigger = Boolean(props.isTrigger);

        const placeholderText = () => {
            if (placeholderOverride) return placeholderOverride;
            if (isTrigger) return "(any)";
            const raw = def?.placeholder || token.label || "(any)";
            if (raw === "any" || raw === "(any)") return "(any)";
            return raw.charAt(0).toUpperCase() + raw.slice(1);
        };

        const displayValue = () => (hasValue() ? String(val()) : "");

        const isColorless = () => !hasValue() && Boolean(isTrigger || !def?.required || props.static);

        const isRequiredError = () => !hasValue() && Boolean(def?.required) && !isTrigger && !props.static;

        if (def?.type === "boolean") {
            const currentBool = () =>
                hasValue()
                    ? Boolean(val())
                    : Boolean(def?.default ?? false);

            return (
                <span
                    class={`actionInput actionInputBool ${currentBool() ? "isTrue" : "isFalse"}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        if (props.static || !props.id) return;
                        e.stopPropagation();
                        props.onValueChange?.(props.id, key, !currentBool());
                    }}
                    title={`Click to toggle (${currentBool() ? "True" : "False"})`}
                >
                    {currentBool() ? "true" : "false"}
                </span>
            );
        }

        if (def?.options && def.options.length > 0) {
            const selectedVal = () =>
                hasValue()
                    ? val()
                    : (def.default ?? def.options[0]?.value);
            const selectedOption = () =>
                def.options.find((o: any) => o.value === selectedVal());
            const displayLabel = () =>
                selectedOption()?.label || (hasValue() ? String(val()) : placeholderText());

            return (
                <span
                    class={`actionInput actionInputOption ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        if (props.static || !props.id) return;
                        e.stopPropagation();
                        const target = e.currentTarget as HTMLElement;
                        const rect = target.getBoundingClientRect();
                        props.onRequestOptionPicker?.(
                            props.id,
                            key,
                            Math.round(rect.left),
                            Math.round(rect.bottom + 4),
                            def.options,
                            selectedVal(),
                            (newVal) => {
                                props.onValueChange?.(props.id!, key, newVal);
                            },
                        );
                    }}
                    title={`Select ${token.label}`}
                >
                    <span>{displayLabel()}</span>
                    <PaperIcon class="dropdownChevronIcon">expand_more</PaperIcon>
                </span>
            );
        }

        if (!isTrigger && isTypedOnlyInput(def)) {
            return (
                <TypedVariablePill
                    blockId={props.id}
                    paramKey={key}
                    def={def}
                    value={val()}
                    placeholder={placeholderText()}
                    isTrigger={isTrigger}
                    isRequired={Boolean(def?.required)}
                    disabled={Boolean(props.static)}
                    onChange={(newVal) => {
                        if (props.id) {
                            props.onValueChange?.(props.id, key, newVal);
                        }
                    }}
                    onRequestVariablePicker={(x, y, onInsert, expectedType, isArray) => {
                        if (props.id) {
                            props.onRequestVariablePicker?.(
                                props.id,
                                key,
                                x,
                                y,
                                onInsert,
                                expectedType,
                                isArray,
                            );
                        }
                    }}
                />
            );
        }

        if (def?.type === "color") {
            const hexValue = () => String(val() ?? "").trim();
            const isHex = () =>
                /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hexValue());
            return (
                <span class="actionColorWrap">
                    <Show when={isHex()}>
                        <span
                            class="actionColorDot"
                            style={{ background: hexValue() }}
                            title={hexValue()}
                        />
                    </Show>
                    <ActionEditableField
                        blockId={props.id}
                        paramKey={key}
                        isNumber={false}
                        multiline={false}
                        initialValue={val()}
                        placeholder={placeholderText()}
                        isTrigger={isTrigger}
                        isRequired={Boolean(def?.required)}
                        disabled={Boolean(props.static)}
                        onCommit={(newVal) => {
                            props.onValueChange?.(props.id!, key, newVal);
                        }}
                        onRequestVariablePicker={(x, y, onInsert) => {
                            if (props.id) {
                                props.onRequestVariablePicker?.(props.id, key, x, y, onInsert);
                            }
                        }}
                    />
                </span>
            );
        }

        return (
            <ActionEditableField
                blockId={props.id}
                paramKey={key}
                isNumber={def?.type === "number"}
                multiline={Boolean(def?.multiline)}
                inputMode={def?.type === "url" ? "url" : undefined}
                spellcheck={def?.type === "url" ? false : undefined}
                initialValue={val()}
                placeholder={placeholderText()}
                isTrigger={isTrigger}
                isRequired={Boolean(def?.required)}
                disabled={Boolean(props.static)}
                onCommit={(newVal) => {
                    props.onValueChange?.(props.id!, key, newVal);
                }}
                onRequestVariablePicker={(x, y, onInsert) => {
                    if (props.id) {
                        props.onRequestVariablePicker?.(props.id, key, x, y, onInsert);
                    }
                }}
            />
        );
    };

    const multilineKeys = () => {
        const keys: { key: string; label: string }[] = [];
        for (const t of tokens()) {
            if (t.type === "input" && t.key && paramsMap()[t.key]?.multiline) {
                keys.push({ key: t.key, label: t.label || formatFallbackLabel(t.key) });
            }
        }
        return keys;
    };

    const schemaInputs = () => (props.action as ActionSchema)?.inputs || {};
    const templateKeySet = () => {
        const set = new Set<string>();
        for (const t of tokens()) {
            if (t.type === "input" && t.key) set.add(t.key);
        }
        return set;
    };
    const extraKeys = () =>
        Object.keys(schemaInputs()).filter((k) => !templateKeySet().has(k));

    const isSourceHighlight = () =>
        Boolean(props.id && props.highlightedSourceBlockId?.() === props.id);

    const stacksVertically = () =>
        Boolean(
            props.isTrigger ||
                isContainerBlock() ||
                extraKeys().length > 0 ||
                multilineKeys().length > 0,
        );

    return (
        <PaperFlex
            class={`action ${props.isTrigger ? "triggerAction" : ""} ${isContainerBlock() ? "triggerAction isContainer" : ""} ${isRunning() ? "runningFlow" : ""} ${isSourceHighlight() ? "sourceHighlight" : ""} ${isDragging() ? "dragging" : ""} ${props.class || ""}`}
            direction={stacksVertically() ? "column" : "row"}
            align={stacksVertically() ? "stretch" : "center"}
            gap="base"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(e) => {
                if (props.static || !props.id) return;
                e.preventDefault();
                e.stopPropagation();
                props.onContextMenu?.(props.id, e.clientX, e.clientY, e);
            }}
            style={{
                ...(props.pos
                    ? {
                          transform: `translate3d(${props.pos.x}px, ${props.pos.y}px, 0)`,
                          "z-index": props.zIndex !== undefined ? props.zIndex : "auto",
                      }
                    : {}),
            }}
        >
            <PaperFlex
                direction="row"
                align="center"
                gap="half"
                class="actionHeaderRow"
                fullWidth
            >
                <Show when={props.iconSrc}>
                    <PaperIcon src={props.iconSrc} class="actionHeaderIcon" />
                </Show>
                <Show when={!props.iconSrc && props.action.icon}>
                    <PaperIcon class="actionHeaderIcon">{props.action.icon}</PaperIcon>
                </Show>

                <span class="actionText" contenteditable="false">
                    <For each={tokens()}>
                        {(token) => {
                            if (token.type === "input") {
                                if (
                                    token.key === "right" &&
                                    (props.values?.operator === "is-true" ||
                                        props.values?.operator === "is-false")
                                ) {
                                    return null;
                                }
                                if (token.key && paramsMap()[token.key]?.multiline) {
                                    return null;
                                }
                                return renderInputPill(token);
                            }
                            return <span contenteditable="false">{token.text}</span>;
                        }}
                    </For>
                </span>
            </PaperFlex>

            <Show when={multilineKeys().length > 0}>
                <For each={multilineKeys()}>
                    {({ key, label }) => (
                        <div class="actionMultilineRow">
                            {renderInputPill({ type: "input", key, label })}
                        </div>
                    )}
                </For>
            </Show>

            <Show when={extraKeys().length > 0}>
                <div class="actionMoreOptions">
                    <PaperButton size="tiny"
                        variant="text"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMoreOptions(!showMoreOptions());
                        }}
                        title={showMoreOptions() ? "Hide extra options" : "Show extra options"}>
                        <PaperIcon>
                            {showMoreOptions() ? "expand_more" : "chevron_right"}
                        </PaperIcon>
                        Options
                    </PaperButton>
                    <Show when={showMoreOptions()}>
                        <For each={extraKeys()}>
                            {(key) => {
                                const def = schemaInputs()[key];
                                return (
                                    <div class="actionMoreOptionsRow">
                                        <PaperText size={3} weight={500}>
                                            {def?.label || formatFallbackLabel(key)}
                                        </PaperText>
                                        {renderInputPill(
                                            {
                                                type: "input",
                                                key,
                                                label: def?.label || formatFallbackLabel(key),
                                            },
                                            friendlyTypeName(def?.type),
                                        )}
                                    </div>
                                );
                            }}
                        </For>
                    </Show>
                </div>
            </Show>

            <Show when={!props.isTrigger && props.variableName}>
                <div
                    class="actionVariableFooter"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                        if (props.id) props.onContextMenu?.(props.id, e.clientX, e.clientY, e);
                    }}
                    title="Right-click for variable options"
                >
                    <span class="actionVariableFooterText">{props.variableName}</span>
                </div>
            </Show>

            <Show when={props.isTrigger || isContainerBlock()}>
                <Show when={props.children && props.children.length > 0}>
                    <div class="triggerNestedActions">
                        <For each={props.children}>
                            {(child, index) => (
                                <>
                                    <div
                                        class={`actionInsertLine ${isHoverIndex(index()) ? "activeHover" : ""}`}
                                        data-drop-parent={props.id}
                                        data-drop-index={index()}
                                    />
                                    <div
                                        class="nestedActionWrapper"
                                        onPointerDown={(e) => {
                                            if (e.button === 2) {
                                                e.stopPropagation();
                                                return;
                                            }
                                            if (e.button !== 0) return;
                                            if ((e.target as HTMLElement).closest(".actionInput")) return;
                                            e.stopPropagation();
                                            const target = e.currentTarget as HTMLElement;
                                            const rect = target.getBoundingClientRect();
                                            const grabOffset = {
                                                x: Math.round(e.clientX - rect.left),
                                                y: Math.round(e.clientY - rect.top),
                                            };
                                            props.onStartDragChild?.(child, grabOffset, e);
                                        }}
                                    >
                                        <ActionBlock
                                            id={child.id}
                                            action={child.action}
                                            isTrigger={child.isTrigger}
                                            values={child.values}
                                            children={child.children}
                                            elseChildren={child.elseChildren}
                                            iconSrc={child.iconSrc}
                                            static={false}
                                            variableName={child.variableName}
                                            activeDropTarget={props.activeDropTarget}
                                            onContextMenu={props.onContextMenu}
                                            onStartDragChild={props.onStartDragChild}
                                            onValueChange={props.onValueChange}
                                            running={Boolean(child.id && props.runningBlockIds?.().has(child.id))}
                                            runningBlockIds={props.runningBlockIds}
                                            onRequestVariablePicker={props.onRequestVariablePicker}
                                            onRequestOptionPicker={props.onRequestOptionPicker}
                                            activeTargetBlockId={props.activeTargetBlockId}
                                            highlightedSourceBlockId={props.highlightedSourceBlockId}
                                            isVariablePickerOpen={props.isVariablePickerOpen}
                                        />
                                    </div>
                                </>
                            )}
                        </For>
                    </div>
                </Show>

                <div
                    class={`actionDropZone ${isHoverIndex(props.children?.length || 0) ? "activeHover" : ""}`}
                    data-drop-parent={props.id}
                    data-drop-index={props.children?.length || 0}
                >
                    <PaperIcon>add</PaperIcon>
                    <span>Drop Actions Here</span>
                </div>

                    <Show when={props.action.id === "if-else"}>
                    <PaperText size={3} weight={500} class="ifElsePlain">
                        else
                    </PaperText>

                    <Show when={props.elseChildren && props.elseChildren.length > 0}>
                        <div class="triggerNestedActions">
                            <For each={props.elseChildren}>
                                {(child, index) => (
                                    <>
                                        <div
                                            class={`actionInsertLine ${isHoverIndex(index(), "else") ? "activeHover" : ""}`}
                                            data-drop-parent={`${props.id}:else`}
                                            data-drop-index={index()}
                                        />
                                        <div
                                            class="nestedActionWrapper"
                                            onPointerDown={(e) => {
                                                if (e.button === 2) {
                                                    e.stopPropagation();
                                                    return;
                                                }
                                                if (e.button !== 0) return;
                                                if ((e.target as HTMLElement).closest(".actionInput")) return;
                                                e.stopPropagation();
                                                const target = e.currentTarget as HTMLElement;
                                                const rect = target.getBoundingClientRect();
                                                const grabOffset = {
                                                    x: Math.round(e.clientX - rect.left),
                                                    y: Math.round(e.clientY - rect.top),
                                                };
                                                props.onStartDragChild?.(child, grabOffset, e);
                                            }}
                                        >
                                            <ActionBlock
                                                id={child.id}
                                                action={child.action}
                                                isTrigger={child.isTrigger}
                                                values={child.values}
                                                children={child.children}
                                                elseChildren={child.elseChildren}
                                                iconSrc={child.iconSrc}
                                                static={false}
                                                variableName={child.variableName}
                                                activeDropTarget={props.activeDropTarget}
                                                onContextMenu={props.onContextMenu}
                                                onStartDragChild={props.onStartDragChild}
                                                onValueChange={props.onValueChange}
                                                running={Boolean(child.id && props.runningBlockIds?.().has(child.id))}
                                                runningBlockIds={props.runningBlockIds}
                                                onRequestVariablePicker={props.onRequestVariablePicker}
                                                activeTargetBlockId={props.activeTargetBlockId}
                                                highlightedSourceBlockId={props.highlightedSourceBlockId}
                                                isVariablePickerOpen={props.isVariablePickerOpen}
                                            />
                                        </div>
                                    </>
                                )}
                            </For>
                        </div>
                    </Show>

                    <div
                        class={`actionDropZone ${isHoverIndex(props.elseChildren?.length || 0, "else") ? "activeHover" : ""}`}
                        data-drop-parent={`${props.id}:else`}
                        data-drop-index={props.elseChildren?.length || 0}
                    >
                        <PaperIcon>add</PaperIcon>
                        <span>Drop Actions Here</span>
                    </div>
                </Show>
            </Show>
        </PaperFlex>
    );
}
