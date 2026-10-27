// A block's free-text field: typed text with variable chips in it, edited in
// place on the card. Numbers, multiline text and URLs are the same field
// with their own rules.
import { createSignal, createEffect, onMount } from "solid-js";
import { plainTextFromClipboard, sanitizeNumberText } from "../../lib/textInput";
import {
    appendVariableChip,
    commitEditableDom,
    deleteVariableChip,
    extractTextWithVariables,
    insertVariableChip,
    placeCaretAtEnd,
    pruneStrandedAnchors,
    renderHtmlWithChips,
} from "../../lib/richText";

export interface ActionEditableFieldProps {
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
    /** the value breaks a limit its input declares */
    invalid?: boolean;
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

export default function ActionEditableField(fieldProps: ActionEditableFieldProps) {
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
            class={`actionInput actionEditable ${fieldProps.multiline ? "actionEditableMultiline" : ""} ${isColorless() ? "colorless" : ""} ${isRequiredError() || fieldProps.invalid ? "requiredError" : ""}`}
            aria-invalid={fieldProps.invalid ? "true" : undefined}
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
