import { createSignal, createMemo, createEffect, onMount, For, Show } from "solid-js";
import {
    PaperFlex,
    PaperIcon,
    PaperText,
    PaperButton,
    PaperSelectMenu,
    PaperSelectMenuItem,
} from "@paperboard-dev/paperui";
import type { ActionSchema } from "@paperboard-dev/paperapi";
import type { CanvasBlock } from "../lib/tree";
import { plainTextFromClipboard, sanitizeNumberText } from "../lib/textInput";
import { parseVariableToken } from "../lib/variableTypes";
import {
    appendVariableChip,
    commitEditableDom,
    deleteVariableChip,
    extractTextWithVariables,
    insertVariableChip,
    placeCaretAtEnd,
    pruneStrandedAnchors,
    renderHtmlWithChips,
} from "../lib/richText";

export interface ActionBlockProps {
    id?: string;
    action: ActionSchema;
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
        anchor?: HTMLElement,
    ) => void;
    onRequestOptionPicker?: (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        options: { label: string; value: any; icon?: string; description?: string }[],
        selectedValue: any,
        onSelect: (value: any) => void,
        anchor?: HTMLElement,
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
    "discord-component": "Component",
    "discord-role": "Role",
    "discord-interaction": "Interaction",
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
        anchor?: HTMLElement,
    ) => void;
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
    let wrapRef: HTMLSpanElement | undefined;
    let savedRange: Range | null = null;
    let lastCommittedVal = fieldProps.initialValue;
    // focusing already opened the picker; a click only reopens it when the
    // field was focused before the press
    let focusedBeforePress = false;

    // while editing, the row keeps the pill's blurred footprint: the value
    // spills over the card instead of reflowing it as you type
    const lockWrapWidth = () => {
        if (!wrapRef || fieldProps.multiline) return;
        wrapRef.style.width = `${wrapRef.getBoundingClientRect().width}px`;
    };

    const releaseWrapWidth = () => {
        if (wrapRef) wrapRef.style.width = "";
    };

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
        const chip = { varId, label, icon };

        const sel = window.getSelection();
        let range: Range | null = savedRange;

        if (!range || !spanRef.contains(range.startContainer)) {
            if (sel && sel.rangeCount > 0 && spanRef.contains(sel.anchorNode)) {
                range = sel.getRangeAt(0);
            }
        }

        if (range) {
            insertVariableChip(spanRef, range, chip);
        } else {
            appendVariableChip(spanRef, chip);
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
            spanRef,
        );
    };

    const handleInput = (e: InputEvent) => {
        if (!spanRef) return;
        // a chip deleted through a selection (cut, drag, range backspace)
        // can leave its invisible anchors behind; they die with it
        pruneStrandedAnchors(spanRef);
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
                commitEditableDom(spanRef, restored, { focused: true, force: true });
                placeCaretAtEnd(spanRef);
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
        // While the field has focus its DOM already IS the display (chips
        // included). commitEditableDom skips the rebuild then, which keeps
        // the caret where the user left it (e.g. right after an inserted
        // variable or after the number restore above). On blur it rewrites.
        commitEditableDom(spanRef, display, {
            focused: document.activeElement === spanRef,
        });
        fieldProps.onCommit?.(parsed);
    };

    const handlePaste = (e: ClipboardEvent) => {
        if (fieldProps.disabled || !spanRef) return;
        e.preventDefault();
        let text = plainTextFromClipboard(
            e.clipboardData?.getData("text/plain"),
            fieldProps.multiline,
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
            ref={wrapRef}
            class={`actionEditableWrap ${fieldProps.multiline ? "isMultiline" : ""}`}
        >
        <span
            ref={spanRef}
            contenteditable={!fieldProps.disabled}
            onFocus={() => {
                lockWrapWidth();
                // the picker is up whenever the field is focused, however
                // focus arrived (click, tab, programmatic)
                openPicker();
            }}
            class={`actionInput actionEditable ${fieldProps.multiline ? "actionEditableMultiline" : ""} ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
            data-placeholder={fieldProps.placeholder}
            inputmode={fieldProps.inputMode as "url" | undefined}
            spellcheck={fieldProps.spellcheck}
            onPointerDown={(e) => {
                e.stopPropagation();
                focusedBeforePress = document.activeElement === spanRef;
            }}
            onClick={(e) => {
                e.stopPropagation();
                if (!spanRef || fieldProps.disabled) return;
                const chip = (e.target as HTMLElement).closest?.(
                    ".actionVariableChip",
                ) as HTMLElement | null;
                if (chip) {
                    // clicking a chip places the caret on the side you
                    // clicked so you can keep typing next to it, and keeps
                    // the variable picker up: it is the field's affordance
                    // while editing, not a one-shot popup
                    const rect = chip.getBoundingClientRect();
                    placeCaret(
                        spanRef,
                        e.clientX < rect.left + rect.width / 2 ? "before" : "after",
                        chip,
                    );
                    saveCurrentRange();
                    if (focusedBeforePress) openPicker();
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
                // the picker is the field's variable affordance: opening it
                // on focus, not on a typed "@" (which is now plain text)
                if (focusedBeforePress) openPicker();
            }}
            onKeyUp={saveCurrentRange}
            onMouseUp={saveCurrentRange}
            onInput={handleInput}
            onPaste={handlePaste}
            onBeforeInput={(e) => {
                if (!fieldProps.isNumber || fieldProps.disabled || !spanRef) return;
                const data = (e as InputEvent).data;
                if (data === null || data === undefined) return;
                const current = extractTextWithVariables(spanRef);
                // a keystroke that sanitizes away (a letter, a second dot)
                // must never enter the field
                if (sanitizeNumberText(current + data) === current) {
                    e.preventDefault();
                }
            }}
            onBlur={() => {
                releaseWrapWidth();
                handleCommit();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();

                if (e.key === "Enter") {
                    if (!fieldProps.multiline) {
                        e.preventDefault();
                        spanRef?.blur();
                        return;
                    }
                    // a multiline value keeps the line the user typed
                    e.preventDefault();
                    if (spanRef) {
                        insertPlainTextAtCaret(spanRef, "\n");
                        saveCurrentRange();
                        handleCommit();
                    }
                    return;
                }
                if (e.key === "Escape") {
                    spanRef?.blur();
                    return;
                }

                if (e.key === "Backspace" || e.key === "Delete") {
                    if (spanRef && deleteVariableChip(spanRef, e.key)) {
                        e.preventDefault();
                        handleCommit();
                    }
                }
            }}
        />
        </span>
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
        anchor?: HTMLElement,
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
            pillRef,
        );
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
        requestAnimationFrame(() => {
            if (pillRef) placeCaretAtEnd(pillRef);
        });
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
    const [isEditing, setIsEditing] = createSignal(false);
    const [showMoreOptions, setShowMoreOptions] = createSignal(false);
    let dragStart = { x: 0, y: 0 };
    let posStart = { x: 0, y: 0 };

    const paramsMap = createMemo(() => {
        const act = props.action as ActionSchema;
        const map: Record<string, any> = {
            ...(act?.inputs || {}),
        };
        if (act?.output) {
            if (typeof act.output === "string") {
                map[act.output] = {
                    label: formatFallbackLabel(act.output),
                    type: act.output,
                };
                map["output"] = { label: "Output", type: act.output };
            } else if (typeof act.output === "object") {
                const outType = (act.output as any).type || "output";
                map[outType] = {
                    label: (act.output as any).label || formatFallbackLabel(outType),
                    type: outType,
                };
                map["output"] = {
                    label: (act.output as any).label || "Output",
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
        props.action.id === "if-else" ||
        props.action.id === "try-catch";

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
            // a boolean holds either a literal (click toggles it) or one
            // variable (right-click opens the picker; clicking the chip
            // replaces it, the close button clears back to a literal)
            const boundVariable = () => parseVariableToken(val());

            const currentBool = () =>
                hasValue()
                    ? Boolean(val())
                    : Boolean(def?.default ?? false);

            const openPicker = (x: number, y: number) => {
                if (props.static || !props.id) return;
                props.onRequestVariablePicker?.(
                    props.id,
                    key,
                    x,
                    y,
                    (varId, label, icon) => {
                        props.onValueChange?.(props.id!, key, `{{${varId}:${label}:${icon}}}`);
                    },
                    "boolean",
                );
            };

            const clearVariable = (e: MouseEvent) => {
                if (props.static || !props.id) return;
                e.stopPropagation();
                props.onValueChange?.(props.id!, key, undefined);
            };

            return (
                <span
                    class={`actionInput actionInputBool ${boundVariable() ? "hasVariable" : currentBool() ? "isTrue" : "isFalse"}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openPicker(e.clientX, e.clientY);
                    }}
                    onClick={(e) => {
                        if (props.static || !props.id) return;
                        e.stopPropagation();
                        const variable = boundVariable();
                        if (variable) {
                            if ((e.target as HTMLElement).closest?.(".actionBoolClear")) {
                                clearVariable(e);
                                return;
                            }
                            openPicker(e.clientX, e.clientY);
                            return;
                        }
                        props.onValueChange?.(props.id, key, !currentBool());
                    }}
                    title={
                        boundVariable()
                            ? "Click to change the variable, right-click to replace it"
                            : `Click to toggle (${currentBool() ? "True" : "False"})`
                    }
                >
                    <Show
                        when={boundVariable()}
                        fallback={currentBool() ? "true" : "false"}
                    >
                        {(variable) => (
                            <>
                                <span
                                    class="actionVariableChip"
                                    data-var-id={variable().id}
                                    data-label={variable().label}
                                    data-icon={variable().icon}
                                >
                                    <span class="chipIcon">{variable().icon}</span>
                                    <span class="chipLabel">{variable().label}</span>
                                </span>
                                <span
                                    class="actionBoolClear"
                                    title="Clear variable"
                                >
                                    <PaperIcon>close</PaperIcon>
                                </span>
                            </>
                        )}
                    </Show>
                </span>
            );
        }

        if (Array.isArray(def?.options) && (def.options.length > 0 || def.allowEmpty)) {
            // a clearable dropdown can be unselected: the empty entry is
            // offered in the picker and shown on the pill as "(any)" (or the
            // schema's own emptyLabel), never auto-replaced by the first option
            const allowEmpty = Boolean(def.allowEmpty);
            const emptyLabel = def.emptyLabel || "(any)";
            const optionList = () => (def.options ?? []) as { label: string; value: any; icon?: string; description?: string }[];
            const selectedVal = () =>
                hasValue()
                    ? val()
                    : allowEmpty
                      ? null
                      : (def.default ?? optionList()[0]?.value);
            const selectedOption = () => optionList().find((o: any) => o.value === selectedVal());
            const displayLabel = () =>
                selectedOption()?.label ||
                (hasValue()
                    ? String(val())
                    : allowEmpty
                      ? emptyLabel
                      : placeholderText());
            // a dropdown holds either a literal option or one variable
            // (right-click opens the picker, like booleans; a wrong-typed
            // value flows to the service and fails loudly in the console)
            const boundVariable = () => parseVariableToken(val());

            const openPicker = (x: number, y: number) => {
                if (props.static || !props.id) return;
                props.onRequestVariablePicker?.(
                    props.id,
                    key,
                    x,
                    y,
                    (varId, label, icon) => {
                        props.onValueChange?.(props.id!, key, `{{${varId}:${label}:${icon}}}`);
                    },
                    typeof def?.type === "string" ? def.type : "string",
                );
            };

            const clearVariable = (e: MouseEvent) => {
                if (props.static || !props.id) return;
                e.stopPropagation();
                props.onValueChange?.(props.id!, key, undefined);
            };

            return (
                <span
                    class={`actionInput actionInputOption ${isColorless() ? "colorless" : ""} ${isRequiredError() ? "requiredError" : ""}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openPicker(e.clientX, e.clientY);
                    }}
                    onClick={(e) => {
                        if (props.static || !props.id) return;
                        e.stopPropagation();
                        if (boundVariable()) {
                            if ((e.target as HTMLElement).closest?.(".actionBoolClear")) {
                                clearVariable(e);
                                return;
                            }
                            openPicker(e.clientX, e.clientY);
                            return;
                        }
                        const target = e.currentTarget as HTMLElement;
                        const rect = target.getBoundingClientRect();
                        props.onRequestOptionPicker?.(
                            props.id,
                            key,
                            Math.round(rect.left),
                            Math.round(rect.bottom + 4),
                            [
                                ...(allowEmpty ? [{ label: emptyLabel, value: null }] : []),
                                ...optionList(),
                            ],
                            selectedVal(),
                            (newVal) => {
                                props.onValueChange?.(props.id!, key, newVal === null ? undefined : newVal);
                            },
                            target,
                        );
                    }}
                    title={
                        boundVariable()
                            ? "Click to change the variable, right-click to replace it"
                            : allowEmpty ? `Select ${token.label} (${emptyLabel})` : `Select ${token.label}`
                    }
                >
                    <Show
                        when={boundVariable()}
                        fallback={
                            <>
                                <span>{displayLabel()}</span>
                                <PaperIcon class="dropdownChevronIcon">expand_more</PaperIcon>
                            </>
                        }
                    >
                        {(variable) => (
                            <>
                                <span
                                    class="actionVariableChip"
                                    data-var-id={variable().id}
                                    data-label={variable().label}
                                    data-icon={variable().icon}
                                >
                                    <span class="chipIcon">{variable().icon}</span>
                                    <span class="chipLabel">{variable().label}</span>
                                </span>
                                <span
                                    class="actionBoolClear"
                                    title="Clear variable"
                                >
                                    <PaperIcon>close</PaperIcon>
                                </span>
                            </>
                        )}
                    </Show>
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
                    onRequestVariablePicker={(x, y, onInsert, expectedType, isArray, anchor) => {
                        if (props.id) {
                            props.onRequestVariablePicker?.(
                                props.id,
                                key,
                                x,
                                y,
                                onInsert,
                                expectedType,
                                isArray,
                                anchor,
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
                        initialValue={val()}
                        placeholder={placeholderText()}
                        isTrigger={isTrigger}
                        isRequired={Boolean(def?.required)}
                        disabled={Boolean(props.static)}
                        onCommit={(newVal) => {
                            props.onValueChange?.(props.id!, key, newVal);
                        }}
                        onRequestVariablePicker={(x, y, onInsert, anchor) => {
                            if (props.id) {
                                props.onRequestVariablePicker?.(
                                    props.id,
                                    key,
                                    x,
                                    y,
                                    onInsert,
                                    expectedTypeOf(def),
                                    false,
                                    anchor,
                                );
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
                onRequestVariablePicker={(x, y, onInsert, anchor) => {
                    if (props.id) {
                        props.onRequestVariablePicker?.(
                            props.id,
                            key,
                            x,
                            y,
                            onInsert,
                            expectedTypeOf(def),
                            false,
                            anchor,
                        );
                    }
                }}
            />
        );
    };

    const schemaInputs = () => (props.action as ActionSchema)?.inputs || {};

    // A multiline input is declared by its own schema flag and gets a
    // wrapping block row under the header instead of an inline pill. Today
    // only the builtin Text action declares it.
    const multilineKeys = () => {
        const keys: { key: string; label: string }[] = [];
        for (const t of tokens()) {
            if (t.type === "input" && t.key && paramsMap()[t.key]?.multiline) {
                keys.push({ key: t.key, label: t.label || formatFallbackLabel(t.key) });
            }
        }
        return keys;
    };

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
            onFocusIn={() => setIsEditing(true)}
            onFocusOut={(e) => {
                // focus moves between the card's own fields while editing;
                // only a focus leaving the card ends the editing state
                const next = e.relatedTarget as Node | null;
                if (!next || !(e.currentTarget as HTMLElement).contains(next)) {
                    setIsEditing(false);
                }
            }}
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
                          "z-index": isEditing()
                              ? 999999
                              : props.zIndex !== undefined
                                ? props.zIndex
                                : "auto",
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
                                            def?.typeName || friendlyTypeName(def?.type),
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

                    <Show when={props.action.id === "if-else" || props.action.id === "try-catch"}>
                    <PaperText size={3} weight={500} class="ifElsePlain">
                        {props.action.id === "try-catch" ? "catch" : "else"}
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
