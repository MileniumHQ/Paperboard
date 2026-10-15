import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperModal,
    PaperQuote,
    PaperSwatch,
    getVarCss,
} from "@mileniumhq/paperui";
import {
    applyCode,
    DEFAULT_MOTD,
    docFromMotd,
    MOTD_COLORS,
    MOTD_FORMATS,
    motdFromDoc,
    plainStyle,
    replaceRange,
    sameStyle,
    selectionStyle,
    styleAt,
    styleWithCode,
    type MotdDoc,
    type MotdStyle,
} from "../core/motd";
import { readServerPropertiesStrict, writeServerProperties } from "../lib/properties";
import { loadServerConfig } from "../lib/server";
import { cssFor, listBox } from "./MotdPreview";

export { MotdPreview } from "./MotdPreview";

const UNDO_LIMIT = 100;

const FORMAT_ICONS: Record<string, string> = {
    l: "format_bold",
    o: "format_italic",
    n: "format_underlined",
    m: "format_strikethrough",
    k: "blur_on",
};

const SHORTCUTS: Record<string, string> = { b: "l", i: "o", u: "n" };

// ---- the editable surface: one <div> per line, one <span> per style run ----

const STYLE_ATTR = "data-motd-style";

const encodeStyle = (style: MotdStyle) =>
    (style.color ?? "") + "|" + MOTD_FORMATS.filter((f) => style[f.key]).map((f) => f.code).join("");

function decodeStyle(value: string): MotdStyle {
    const [color, formats = ""] = value.split("|");
    const style = plainStyle(color || undefined);
    for (const f of MOTD_FORMATS) style[f.key] = formats.includes(f.code);
    return style;
}

function renderDoc(root: HTMLElement, doc: MotdDoc) {
    const lines: HTMLDivElement[] = [document.createElement("div")];
    let run: { span: HTMLSpanElement; style: MotdStyle } | null = null;
    for (const cell of doc) {
        if (cell.ch === "\n") {
            lines.push(document.createElement("div"));
            run = null;
            continue;
        }
        if (!run || !sameStyle(run.style, cell.style)) {
            const span = document.createElement("span");
            span.setAttribute(STYLE_ATTR, encodeStyle(cell.style));
            for (const [name, value] of Object.entries(cssFor(cell.style, true))) {
                if (value !== undefined) span.style.setProperty(name, value);
            }
            lines[lines.length - 1].append(span);
            run = { span, style: cell.style };
        }
        run.span.textContent += cell.ch;
    }
    // an empty line needs content to hold its height and the caret
    for (const line of lines) if (!line.firstChild) line.append(document.createElement("br"));
    root.replaceChildren(...lines);
}

const lineElements = (root: HTMLElement) =>
    Array.from(root.children).filter((el): el is HTMLElement => el.tagName === "DIV");

const lineLength = (line: HTMLElement) => line.textContent?.length ?? 0;

// the DOM back into a doc, after the browser edited it itself (IME composition)
function readDoc(root: HTMLElement): MotdDoc {
    const doc: MotdDoc = [];
    let previous = plainStyle();
    lineElements(root).forEach((line, index) => {
        if (index > 0) doc.push({ ch: "\n", style: previous });
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const owner = node.parentElement?.closest(`[${STYLE_ATTR}]`);
            const style = owner ? decodeStyle(owner.getAttribute(STYLE_ATTR) ?? "") : previous;
            for (const ch of node.textContent ?? "") doc.push({ ch, style });
            previous = style;
        }
    });
    return doc;
}

// a DOM position as a doc offset: each earlier line counts its text plus its break
function pointToOffset(root: HTMLElement, node: Node, offset: number): number {
    const lines = lineElements(root);
    let base = 0;
    for (const [index, line] of lines.entries()) {
        if (node === root && offset === index) return base;
        if (line === node || line.contains(node)) {
            const range = document.createRange();
            range.setStart(line, 0);
            range.setEnd(node, offset);
            return base + range.toString().length;
        }
        base += lineLength(line) + 1;
    }
    return Math.max(0, base - 1);
}

function offsetToPoint(root: HTMLElement, offset: number): [Node, number] {
    const lines = lineElements(root);
    let remaining = offset;
    for (const [index, line] of lines.entries()) {
        const length = lineLength(line);
        if (remaining <= length || index === lines.length - 1) {
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const size = node.textContent?.length ?? 0;
                if (remaining <= size) return [node, remaining];
                remaining -= size;
            }
            return [line, 0];
        }
        remaining -= length + 1;
    }
    return [root, 0];
}

export function MotdEditor(props: { open: boolean; onClose: () => void }) {
    const [loaded, setLoaded] = createSignal(false);
    const [loadError, setLoadError] = createSignal(false);
    const [saveError, setSaveError] = createSignal(false);
    const [saving, setSaving] = createSignal(false);
    const [focused, setFocused] = createSignal(false);
    const [active, setActive] = createSignal<MotdStyle>(plainStyle());

    let root: HTMLDivElement | undefined;
    let doc: MotdDoc = [];
    // a code picked with nothing selected applies to what is typed next
    let pending: { style: MotdStyle; at: number } | null = null;
    const undo: { doc: MotdDoc; caret: number }[] = [];
    const redo: { doc: MotdDoc; caret: number }[] = [];

    const selection = (): [number, number] | null => {
        const sel = window.getSelection();
        if (!root || !sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
        if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
        const a = pointToOffset(root, sel.anchorNode, sel.anchorOffset);
        const b = pointToOffset(root, sel.focusNode, sel.focusOffset);
        return [Math.min(a, b), Math.max(a, b)];
    };

    const select = (start: number, end = start) => {
        const sel = window.getSelection();
        if (!root || !sel) return;
        const range = document.createRange();
        range.setStart(...offsetToPoint(root, start));
        range.setEnd(...offsetToPoint(root, end));
        sel.removeAllRanges();
        sel.addRange(range);
    };

    const refreshActive = () => {
        const range = selection();
        if (!range) return;
        if (pending && pending.at !== range[0]) pending = null;
        setActive(pending?.style ?? selectionStyle(doc, range[0], range[1]));
    };

    const show = (next: MotdDoc, start: number, end = start) => {
        doc = next;
        if (root) renderDoc(root, doc);
        select(start, end);
        refreshActive();
    };

    const commit = (next: MotdDoc, start: number, end = start) => {
        undo.push({ doc, caret: selection()?.[0] ?? 0 });
        if (undo.length > UNDO_LIMIT) undo.shift();
        redo.length = 0;
        show(next, start, end);
    };

    const history = (back: boolean) => {
        const [from, to] = back ? [undo, redo] : [redo, undo];
        const entry = from.pop();
        if (!entry) return;
        to.push({ doc, caret: selection()?.[0] ?? 0 });
        show(entry.doc, entry.caret);
    };

    const load = async () => {
        setLoaded(false);
        setLoadError(false);
        setSaveError(false);
        try {
            const values = await readServerPropertiesStrict();
            doc = docFromMotd(values.motd ?? DEFAULT_MOTD);
            undo.length = 0;
            redo.length = 0;
            pending = null;
            if (root) renderDoc(root, doc);
            setLoaded(true);
        } catch (err) {
            console.error("[motd] server.properties read failed:", err);
            setLoadError(true);
        }
    };

    createEffect(() => {
        if (props.open) void load();
    });

    document.addEventListener("selectionchange", refreshActive);
    onCleanup(() => document.removeEventListener("selectionchange", refreshActive));

    const applyFormat = (code: string) => {
        const range = selection();
        if (!range) return;
        const [start, end] = range;
        if (start === end) {
            pending = { style: styleWithCode(pending?.style ?? styleAt(doc, start), code), at: start };
            setActive(pending.style);
            return;
        }
        commit(applyCode(doc, start, end, code), start, end);
    };

    const insert = (start: number, end: number, text: string) => {
        const replaced = start < end && doc[start]?.ch !== "\n" ? doc[start].style : undefined;
        const base = pending?.style ?? replaced ?? styleAt(doc, start);
        pending = null;
        // pasted § codes are read as formatting, plain text takes the caret's style
        const next = replaceRange(doc, start, end, docFromMotd(text.replace(/\r\n?/g, "\n"), base));
        commit(next.doc, next.caret);
    };

    const targetRange = (e: InputEvent): [number, number] | null => {
        const target = e.getTargetRanges?.()[0];
        if (!target || !root) return selection();
        const a = pointToOffset(root, target.startContainer, target.startOffset);
        const b = pointToOffset(root, target.endContainer, target.endOffset);
        return [Math.min(a, b), Math.max(a, b)];
    };

    // every edit goes through the doc, so the DOM only ever holds what the
    // doc renders and pasted markup never reaches it
    const onBeforeInput = (e: InputEvent) => {
        if (e.isComposing || e.inputType === "insertCompositionText") return;
        e.preventDefault();
        if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
            return history(e.inputType === "historyUndo");
        }
        const format = (
            { formatBold: "l", formatItalic: "o", formatUnderline: "n", formatStrikeThrough: "m" } as Record<string, string>
        )[e.inputType];
        if (format) return applyFormat(format);
        const range = targetRange(e);
        if (!range) return;
        const [start, end] = range;
        if (e.inputType.startsWith("delete")) {
            if (start < end) commit(replaceRange(doc, start, end, []).doc, start);
            return;
        }
        if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") return insert(start, end, "\n");
        const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
        if (text) insert(start, end, text);
    };

    // undo and the format shortcuts, for browsers that don't send them as input events
    const onKeyDown = (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
            e.preventDefault();
            history(key === "z" && !e.shiftKey);
        } else if (SHORTCUTS[key] && !e.shiftKey) {
            e.preventDefault();
            applyFormat(SHORTCUTS[key]);
        }
    };

    const onCompositionEnd = () => {
        if (!root) return;
        commit(readDoc(root), selection()?.[0] ?? 0);
    };

    const save = async () => {
        setSaving(true);
        setSaveError(false);
        try {
            await writeServerProperties({ motd: motdFromDoc(doc) });
            await loadServerConfig();
            props.onClose();
        } catch (err) {
            console.error("[motd] save failed:", err);
            setSaveError(true);
        } finally {
            setSaving(false);
        }
    };

    // toolbar buttons keep the editor's selection instead of taking focus
    const keepSelection = (e: MouseEvent) => e.preventDefault();

    return (
        <PaperModal
            open={props.open}
            onClose={props.onClose}
            title="Server list message"
            size="medium"
            footer={
                <PaperFlex direction="row" justify="flex-end" gap="half" fullWidth>
                    <PaperButton onClick={props.onClose}>Cancel</PaperButton>
                    <PaperButton variant="primary" disabled={!loaded() || saving()} onClick={() => void save()}>
                        Save
                    </PaperButton>
                </PaperFlex>
            }
        >
            <Show
                when={!loadError()}
                fallback={
                    <PaperQuote variant="danger" icon="warning" title="Couldn't read server.properties">
                        <PaperFlex direction="column" gap="half">
                            <span>The message can't be edited until the file can be read.</span>
                            <PaperFlex direction="row">
                                <PaperButton onClick={() => void load()}>Retry</PaperButton>
                            </PaperFlex>
                        </PaperFlex>
                    </PaperQuote>
                }
            >
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperFlex direction="row" gap="onefourth" align="center" wrap>
                        <For each={MOTD_FORMATS}>
                            {(format) => (
                                <PaperButton
                                    size="tiny"
                                    icon
                                    title={format.name}
                                    aria-label={format.name}
                                    aria-pressed={active()[format.key]}
                                    disabled={!loaded()}
                                    onMouseDown={keepSelection}
                                    onClick={() => applyFormat(format.code)}
                                >
                                    {FORMAT_ICONS[format.code]}
                                </PaperButton>
                            )}
                        </For>
                        <PaperButton
                            size="tiny"
                            icon
                            title="Clear formatting"
                            aria-label="Clear formatting"
                            disabled={!loaded()}
                            onMouseDown={keepSelection}
                            onClick={() => applyFormat("r")}
                        >
                            format_clear
                        </PaperButton>
                        <For each={MOTD_COLORS}>
                            {(color) => (
                                <PaperButton
                                    size="tiny"
                                    icon
                                    title={color.name}
                                    aria-label={color.name}
                                    aria-pressed={active().color === color.code}
                                    disabled={!loaded()}
                                    onMouseDown={keepSelection}
                                    onClick={() => applyFormat(color.code)}
                                >
                                    <PaperSwatch color={color.hex} />
                                </PaperButton>
                            )}
                        </For>
                    </PaperFlex>

                    <div
                        ref={root}
                        role="textbox"
                        aria-multiline="true"
                        aria-label="Server list message"
                        contentEditable={loaded()}
                        spellcheck={false}
                        onBeforeInput={onBeforeInput}
                        onKeyDown={onKeyDown}
                        onCompositionEnd={onCompositionEnd}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        style={{
                            ...listBox(),
                            padding: `${getVarCss("uigap-onefourth")} ${getVarCss("uigap-half")}`,
                            border: `${getVarCss("border-width")} solid ${getVarCss("border")}`,
                            "border-radius": getVarCss("border-radius-half"),
                            "min-height": `calc(2em * ${getVarCss("leading-normal")})`,
                            "overflow-x": "auto",
                            outline: focused() ? getVarCss("focus-ring") : "none",
                            cursor: "text",
                        }}
                    />

                    <Show when={saveError()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't save">
                            The message wasn't saved. Try again.
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </Show>
        </PaperModal>
    );
}
