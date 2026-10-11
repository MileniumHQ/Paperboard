import styles from "./index.module.css";
import tokens from "../shared/codeTokens.module.css";
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from "solid-js";
import { escapeHtml, grammarFor, highlightLines } from "../../utils/highlight";
import { caretPosition, detectIndent, indentEdit, newlineEdit, type TextEdit } from "./edit";

export { detectIndent, indentEdit, newlineEdit, caretPosition } from "./edit";
export type { TextEdit } from "./edit";

/**
 * Past this many characters the editor stops highlighting and shows plain
 * text: re-tokenizing a large file on every keystroke would make typing lag.
 */
export const PAPER_EDITOR_HIGHLIGHT_LIMIT = 200_000;

export interface PaperEditorPosition {
    line: number;
    column: number;
}

export interface PaperEditorProps {
    value: string;
    onChange?: (value: string) => void;
    /** Prism language id (yaml, toml, properties, json, ...); omit for plain text */
    language?: string;
    /** colour the text when `language` has a grammar (default true) */
    highlight?: boolean;
    /** default true */
    lineNumbers?: boolean;
    /** soft-wrap long lines instead of scrolling sideways (default false) */
    wrap?: boolean;
    readOnly?: boolean;
    /** what Tab inserts: "auto" (what the text already uses), "tab", or a number of spaces */
    indent?: "auto" | "tab" | number;
    /** Ctrl+S / Cmd+S */
    onSave?: () => void;
    onCursorChange?: (position: PaperEditorPosition) => void;
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    class?: string;
    classList?: JSX.ClassList;
    textareaRef?: (el: HTMLTextAreaElement) => void;
}

/**
 * A plain-text code editor: a real textarea (native caret, selection, undo,
 * IME and screen-reader support) laid over a highlighted copy of the same
 * text. Each line is its own grid row beside its number, so numbers stay
 * aligned when lines wrap.
 */
export function PaperEditor(props: PaperEditorProps) {
    let textarea: HTMLTextAreaElement | undefined;
    const [text, setText] = createSignal(props.value);
    // Escape then Tab leaves the editor: Tab is otherwise an indent key, and
    // keyboard users must still be able to move on
    let tabLeaves = false;

    // an outside change (another file opened, a revert) replaces the text;
    // the editor's own typing already matches and must not reset the caret
    // or the undo history
    createEffect(
        on(
            () => props.value,
            (value) => {
                if (value === text()) return;
                setText(value);
                if (textarea && textarea.value !== value) textarea.value = value;
            },
        ),
    );

    const lines = createMemo(() => text().split("\n"));
    const highlighted = createMemo(
        () =>
            (props.highlight ?? true) &&
            grammarFor(props.language) !== null &&
            text().length <= PAPER_EDITOR_HIGHLIGHT_LIMIT,
    );
    const rows = createMemo(() => {
        if (highlighted()) {
            const html = highlightLines(text(), props.language);
            if (html) return html;
        }
        return lines().map(escapeHtml);
    });
    const showNumbers = () => props.lineNumbers ?? true;

    const indentUnit = () => {
        const indent = props.indent ?? "auto";
        if (indent === "tab") return "\t";
        if (typeof indent === "number") return " ".repeat(Math.min(Math.max(indent, 1), 8));
        return detectIndent(text());
    };

    const reportCursor = () => {
        if (!textarea || !props.onCursorChange) return;
        props.onCursorChange(caretPosition(textarea.value, textarea.selectionStart));
    };

    const commit = (value: string) => {
        setText(value);
        props.onChange?.(value);
        reportCursor();
    };

    /** applies one edit as a native insertion so the browser's undo keeps it */
    const apply = (edit: TextEdit) => {
        if (!textarea) return;
        textarea.setSelectionRange(edit.from, edit.to);
        const inserted =
            edit.insert === ""
                ? document.execCommand?.("delete", false)
                : document.execCommand?.("insertText", false, edit.insert);
        if (!inserted) {
            // no execCommand (non-browser hosts): still correct, without undo
            textarea.setRangeText(edit.insert, edit.from, edit.to, "end");
            commit(textarea.value);
        }
        textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
        reportCursor();
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (!textarea) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
            e.preventDefault();
            props.onSave?.();
            return;
        }
        if (e.key === "Escape") {
            tabLeaves = true;
            return;
        }
        if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (tabLeaves || props.readOnly) {
                tabLeaves = false;
                return;
            }
            e.preventDefault();
            const edit = indentEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, indentUnit(), e.shiftKey);
            if (edit) apply(edit);
            return;
        }
        tabLeaves = false;
        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !props.readOnly) {
            e.preventDefault();
            apply(newlineEdit(textarea.value, textarea.selectionStart, textarea.selectionEnd, indentUnit(), props.language));
        }
    };

    const gridStyle = () => ({
        // the last row takes the spare height, so a short file's lines keep
        // their own height instead of stretching apart to fill the editor
        "grid-template-rows": `repeat(${rows().length}, auto) 1fr`,
        "grid-template-columns": showNumbers() ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
    });
    const codeColumn = () => (showNumbers() ? "2" : "1");

    return (
        <div
            class={[styles.PaperEditor, props.class].filter(Boolean).join(" ")}
            classList={{
                ...props.classList,
                [styles.wrap]: Boolean(props.wrap),
                [styles.highlighted]: highlighted(),
                [styles.readOnly]: Boolean(props.readOnly),
            }}
        >
            <div class={styles.scroller}>
                <div class={[styles.grid, tokens.tokens].join(" ")} style={gridStyle()}>
                    <For each={rows()}>
                        {(html, index) => (
                            <>
                                <Show when={showNumbers()}>
                                    <span
                                        class={styles.number}
                                        style={{ "grid-row": String(index() + 1) }}
                                        aria-hidden="true"
                                    >
                                        {index() + 1}
                                    </span>
                                </Show>
                                <div
                                    class={styles.line}
                                    style={{ "grid-row": String(index() + 1), "grid-column": codeColumn() }}
                                    aria-hidden="true"
                                    innerHTML={html}
                                />
                            </>
                        )}
                    </For>
                    <textarea
                        ref={(el) => {
                            textarea = el;
                            el.value = text();
                            props.textareaRef?.(el);
                        }}
                        id={props.id}
                        class={styles.input}
                        style={{ "grid-row": `1 / ${rows().length + 2}`, "grid-column": codeColumn() }}
                        wrap={props.wrap ? "soft" : "off"}
                        spellcheck={false}
                        autocapitalize="off"
                        autocomplete="off"
                        readOnly={props.readOnly}
                        aria-label={props["aria-label"]}
                        aria-labelledby={props["aria-labelledby"]}
                        aria-describedby={props["aria-describedby"]}
                        aria-readonly={props.readOnly ? "true" : undefined}
                        onInput={(e) => commit(e.currentTarget.value)}
                        onKeyDown={onKeyDown}
                        onKeyUp={reportCursor}
                        onMouseUp={reportCursor}
                        onSelect={reportCursor}
                        onFocus={reportCursor}
                    />
                </div>
            </div>
        </div>
    );
}
