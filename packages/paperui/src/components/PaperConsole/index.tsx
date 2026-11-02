import styles from "./index.module.css";
import {
    batch,
    createSignal,
    createEffect,
    createMemo,
    on,
    onCleanup,
    onMount,
    splitProps,
    Show,
    For,
    Index,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperInput } from "../PaperInput";
import { PaperIcon } from "../PaperIcon";
import { PaperButton } from "../PaperButton";
import { parseAnsiToSegments } from "../../utils/ansi";

export type PaperConsoleEntryType =
    | "command"
    | "output"
    | "error"
    | "warn"
    | "info"
    | "return";

export interface PaperConsoleEntry {
    id?: string | number;
    type?: PaperConsoleEntryType;
    content: string | JSX.Element;
    timestamp?: string | Date | number;
}

// recall history cap (see history signal below)
export const MAX_CONSOLE_HISTORY = 200;

// entries render through a window: only the rows near the viewport exist in
// the DOM, the rest are a spacer sized from measured (or estimated) heights,
// so the native scrollbar spans the whole log without mounting all of it.
// rows kept mounted beyond each edge of the viewport, in viewport heights
const OVERSCAN_VIEWPORTS = 1;
// rows kept mounted beyond each edge when the viewport isn't laid out yet
const MIN_OVERSCAN_ROWS = 40;
// row height guess before anything has been measured
const INITIAL_ROW_ESTIMATE = 24;
// entry updates are folded into one render per this many ms (about a frame)
const FLUSH_INTERVAL_MS = 16;

type RawEntry = PaperConsoleEntry | string;

function entryType(entry: RawEntry): PaperConsoleEntryType {
    return typeof entry === "string" ? "output" : entry.type ?? "output";
}

function entryContent(entry: RawEntry): string | JSX.Element {
    return typeof entry === "string" ? entry : entry.content;
}

// rows with the same type and text are the same height at a given width, so
// heights are cached by content — upstream logs are usually rebuilt arrays of
// fresh objects, which an identity key would never hit. the first row has no
// divider, so it gets its own key.
function heightKey(entry: RawEntry, index: number): unknown {
    const content = entryContent(entry);
    if (typeof content !== "string") return content;
    return `${index === 0 ? 1 : 0}${entryType(entry)}\0${content}`;
}

// last row index whose top is at or above y
function rowAt(offsets: Float64Array, count: number, y: number): number {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= y) lo = mid;
        else hi = mid - 1;
    }
    return Math.max(0, lo);
}

export interface PaperConsoleProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onCommand" | "title"> {
    entries?: (PaperConsoleEntry | string)[];
    onCommand?: (command: string) => void;
    /** header label, usually paired with onClear for a log panel */
    title?: JSX.Element | string;
    onClear?: () => void;
    /** false renders a read-only log with no command row */
    showInput?: boolean;
    /** large preformatted body (log files); one text node, auto-scrolled */
    text?: string;
    banner?: string | JSX.Element;
    /** shown in the middle of the output while there are no entries or text, usually a PaperEmptyState */
    empty?: JSX.Element;
    placeholder?: string;
    prompt?: string | JSX.Element;
    inputDisabled?: boolean;
    autoScroll?: boolean;
    divided?: boolean;
    value?: string;
    onInputChange?: (value: string) => void;
}

export function PaperConsole(props: ParentProps<PaperConsoleProps>) {
    let outputRef: HTMLDivElement | undefined;
    let listRef: HTMLDivElement | undefined;
    let windowRef: HTMLDivElement | undefined;
    let inputRef: HTMLInputElement | undefined;

    const [local, rest] = splitProps(props, [
        "entries",
        "onCommand",
        "title",
        "onClear",
        "showInput",
        "text",
        "banner",
        "empty",
        "placeholder",
        "prompt",
        "inputDisabled",
        "autoScroll",
        "divided",
        "value",
        "onInputChange",
        "class",
        "classList",
        "children",
    ]);

    const [inputValue, setInputValue] = createSignal(local.value ?? "");
    // command recall ring: newest commands win, oldest drop past the cap —
    // a long-lived console session must not grow this array forever
    const [history, setHistory] = createSignal<string[]>([]);
    const [historyIndex, setHistoryIndex] = createSignal<number>(-1);
    const [tempInput, setTempInput] = createSignal<string>("");

    createEffect(() => {
        if (local.value !== undefined) {
            setInputValue(local.value);
        }
    });

    // ---- windowed entries ----

    const [items, setItems] = createSignal<readonly RawEntry[]>(local.entries ?? []);
    const heights = new Map<unknown, number>();
    let measuredTotal = 0;
    const [heightsVersion, setHeightsVersion] = createSignal(0);
    const [scrollTop, setScrollTop] = createSignal(0);
    const [viewportHeight, setViewportHeight] = createSignal(0);
    let viewportWidth = 0;
    // following the tail: new output keeps the newest line in view until the
    // user scrolls away from the bottom
    const [stuck, setStuck] = createSignal(local.autoScroll !== false);

    const estimate = () => (heights.size ? measuredTotal / heights.size : INITIAL_ROW_ESTIMATE);

    const setHeight = (key: unknown, height: number) => {
        const prev = heights.get(key);
        // a row's measured height can flicker by a fraction of a pixel as it
        // moves (subpixel layout); taking that as a change would re-lay out
        // the window, move the row and measure it again, forever
        if (prev !== undefined && Math.abs(prev - height) < 0.5) return false;
        measuredTotal += height - (prev ?? 0);
        heights.set(key, height);
        return true;
    };

    const clearHeights = () => {
        heights.clear();
        measuredTotal = 0;
    };

    // offsets[i] is row i's top inside the list; offsets[n] is the list height
    const offsets = createMemo(() => {
        heightsVersion();
        const list = items();
        const guess = estimate();
        const out = new Float64Array(list.length + 1);
        for (let i = 0; i < list.length; i++) {
            out[i + 1] = out[i] + (heights.get(heightKey(list[i], i)) ?? guess);
        }
        return out;
    });

    const listTop = () => listRef?.offsetTop ?? 0;

    const range = createMemo(() => {
        const list = items();
        const o = offsets();
        const total = o[list.length];
        const view = viewportHeight();
        const overscan = Math.max(view * OVERSCAN_VIEWPORTS, estimate() * MIN_OVERSCAN_ROWS);
        // while following, the window sits on the tail even before the
        // scroll position catches up with new rows
        const top = stuck() ? Math.max(0, total - view) : scrollTop() - listTop();
        const start = rowAt(o, list.length, top - overscan);
        const end = Math.min(list.length, rowAt(o, list.length, top + view + overscan) + 1);
        return { start, end };
    });

    const visible = createMemo(() => {
        const { start, end } = range();
        return items().slice(start, end);
    });

    const scrollToBottom = () => {
        if (!outputRef) return;
        outputRef.scrollTop = outputRef.scrollHeight;
        setScrollTop(outputRef.scrollTop);
    };

    // apply a change that moves rows (new entries, re-measured heights)
    // without moving what the reader is looking at: stay on the tail while
    // following, otherwise keep the top visible row at the same spot
    let held: { index: number; key: unknown; delta: number; scrollTop: number } | undefined;
    const relayout = (change: () => void) => {
        const el = outputRef;
        if (!el || stuck()) {
            change();
            if (stuck()) scrollToBottom();
            return;
        }
        const before = items();
        let anchor = held && held.scrollTop === el.scrollTop ? held : undefined;
        if (!anchor) {
            const view = el.scrollTop - listTop();
            if (before.length && view >= 0) {
                const o = offsets();
                const index = rowAt(o, before.length, view);
                anchor = { index, key: heightKey(before[index], index), delta: o[index] - view, scrollTop: 0 };
            }
        }
        change();
        held = undefined;
        if (!anchor) return;
        const after = items();
        // logs drop old rows from the front, so the anchor row can only have
        // moved toward the start; look there first
        let found = -1;
        for (let i = Math.min(anchor.index, after.length - 1); i >= 0; i--) {
            if (heightKey(after[i], i) === anchor.key) {
                found = i;
                break;
            }
        }
        if (found === -1) return;
        const target = listTop() + offsets()[found] - anchor.delta;
        // writing scrollTop cancels a smooth scroll in progress; only do it
        // when rows above the reader actually moved
        if (Math.abs(target - el.scrollTop) >= 0.5) {
            el.scrollTop = target;
            setScrollTop(el.scrollTop);
        }
        // scrollTop snaps to whole pixels; keep the exact anchor so repeated
        // updates don't walk the text by a rounding error each time
        held = { ...anchor, index: found, scrollTop: el.scrollTop };
    };

    // a log can push hundreds of lines a second; fold them into one update
    // per frame instead of re-rendering the window for every line
    let pendingFlush: ReturnType<typeof setTimeout> | undefined;
    createEffect(
        on(
            () => local.entries,
            () => {
                if (pendingFlush !== undefined) return;
                pendingFlush = setTimeout(() => {
                    pendingFlush = undefined;
                    relayout(() => setItems(local.entries ?? []));
                }, FLUSH_INTERVAL_MS);
            },
            { defer: true },
        ),
    );
    onCleanup(() => clearTimeout(pendingFlush));

    // measure the mounted rows; estimates above the viewport turning into
    // real heights are absorbed by relayout so nothing jumps
    createEffect(
        on(visible, () => {
            if (!windowRef || !outputRef?.clientHeight) return;
            const { start } = range();
            const list = items();
            let changed = false;
            const rows = windowRef.children;
            for (let i = 0; i < rows.length; i++) {
                const index = start + i;
                if (index >= list.length) break;
                const height = rows[i].getBoundingClientRect().height;
                if (height > 0 && setHeight(heightKey(list[index], index), height)) changed = true;
            }
            if (heights.size > list.length * 4 + 1000) {
                // drop heights of rows that have scrolled out of the log
                const keep = new Map<unknown, number>();
                list.forEach((entry, i) => {
                    const key = heightKey(entry, i);
                    const h = heights.get(key);
                    if (h !== undefined) keep.set(key, h);
                });
                clearHeights();
                keep.forEach((h, key) => setHeight(key, h));
            }
            if (changed) relayout(() => setHeightsVersion((v) => v + 1));
        }),
    );

    const handleScroll = () => {
        const el = outputRef;
        if (!el) return;
        setScrollTop(el.scrollTop);
        if (local.autoScroll === false) return;
        const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
        setStuck(distance <= estimate() / 2);
    };

    onMount(() => {
        const el = outputRef;
        if (!el) return;
        setViewportHeight(el.clientHeight);
        viewportWidth = el.clientWidth;
        if (stuck()) scrollToBottom();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => {
            const widthChanged = el.clientWidth !== viewportWidth;
            viewportWidth = el.clientWidth;
            relayout(() =>
                batch(() => {
                    setViewportHeight(el.clientHeight);
                    // rows rewrap at a new width; every cached height is stale
                    if (widthChanged) {
                        clearHeights();
                        setHeightsVersion((v) => v + 1);
                    }
                }),
            );
        });
        observer.observe(el);
        onCleanup(() => observer.disconnect());
    });

    createEffect(
        on(
            () => local.autoScroll,
            (auto) => setStuck(auto !== false),
            { defer: true },
        ),
    );

    createEffect(
        on(
            () => [local.children, local.text, local.banner],
            () => {
                if (stuck()) setTimeout(scrollToBottom, 0);
            },
            { defer: true },
        ),
    );

    const handleFormSubmit = (e: Event) => {
        e.preventDefault();
        const cmd = (local.value !== undefined ? local.value : inputValue()).trim();
        if (!cmd) return;

        if (local.onCommand) {
            local.onCommand(cmd);
        }

        setHistory((prev) => {
            const next = [...prev, cmd];
            return next.length > MAX_CONSOLE_HISTORY
                ? next.slice(next.length - MAX_CONSOLE_HISTORY)
                : next;
        });
        setHistoryIndex(-1);
        setTempInput("");

        if (local.value === undefined) {
            setInputValue("");
        }
        local.onInputChange?.("");
        // sending a command returns to the newest output
        if (local.autoScroll !== false) {
            setStuck(true);
            setTimeout(scrollToBottom, 0);
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowUp") {
            const h = history();
            if (h.length === 0) return;
            e.preventDefault();
            if (historyIndex() === -1) {
                setTempInput(inputValue());
                const nextIdx = h.length - 1;
                setHistoryIndex(nextIdx);
                const val = h[nextIdx];
                setInputValue(val);
                local.onInputChange?.(val);
            } else if (historyIndex() > 0) {
                const nextIdx = historyIndex() - 1;
                setHistoryIndex(nextIdx);
                const val = h[nextIdx];
                setInputValue(val);
                local.onInputChange?.(val);
            }
        } else if (e.key === "ArrowDown") {
            const h = history();
            if (historyIndex() === -1) return;
            e.preventDefault();
            if (historyIndex() < h.length - 1) {
                const nextIdx = historyIndex() + 1;
                setHistoryIndex(nextIdx);
                const val = h[nextIdx];
                setInputValue(val);
                local.onInputChange?.(val);
            } else {
                setHistoryIndex(-1);
                const val = tempInput();
                setInputValue(val);
                local.onInputChange?.(val);
            }
        }
    };

    const renderEntryContent = (content: string | JSX.Element): JSX.Element => {
        if (typeof content !== "string") return content;
        if (!content.includes("\x1b")) {
            return content.replace(/\r/g, "");
        }
        const segments = parseAnsiToSegments(content);
        if (segments.length === 1 && Object.keys(segments[0].style).length === 0) {
            return segments[0].text;
        }
        return (
            <For each={segments}>
                {(seg) => (
                    <Show when={Object.keys(seg.style).length > 0} fallback={seg.text}>
                        <span style={seg.style}>{seg.text}</span>
                    </Show>
                )}
            </For>
        );
    };

    const renderPrefix = (type?: PaperConsoleEntryType) => {
        switch (type) {
            case "command":
                return <PaperIcon class={styles.prefixIcon}>chevron_right</PaperIcon>;
            case "return":
                return <PaperIcon class={styles.prefixIcon}>chevron_left</PaperIcon>;
            case "error":
                return <PaperIcon class={styles.prefixIcon}>cancel</PaperIcon>;
            case "warn":
                return <PaperIcon class={styles.prefixIcon}>warning</PaperIcon>;
            case "info":
                return <PaperIcon class={styles.prefixIcon}>info</PaperIcon>;
            case "output":
            default:
                return null;
        }
    };

    const isDivided = () => local.divided !== false;

    return (
        <div
            {...rest}
            class={[
                styles.PaperConsole,
                isDivided() ? styles.divided : "",
                local.class,
            ]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <Show when={local.title || local.onClear}>
                <div class={styles.header}>
                    <span class={styles.headerTitle}>{local.title}</span>
                    <Show when={local.onClear}>
                        <PaperButton size="tiny"
                            icon
                            title="Clear console"
                            onClick={() => local.onClear?.()}>
                            <PaperIcon>delete_sweep</PaperIcon>
                        </PaperButton>
                    </Show>
                </div>
            </Show>

            <div ref={outputRef} class={styles.outputArea} onScroll={handleScroll}>
                <Show when={local.banner}>
                    <div class={styles.banner}>{local.banner}</div>
                </Show>

                <Show when={local.text !== undefined}>
                    <pre class={styles.textBody}>{local.text}</pre>
                </Show>

                <Show when={items().length > 0}>
                    <div
                        ref={listRef}
                        class={styles.entries}
                        style={{ height: `${offsets()[items().length]}px` }}
                    >
                        <div
                            ref={windowRef}
                            class={styles.window}
                            style={{ transform: `translateY(${offsets()[range().start]}px)` }}
                        >
                            <Index each={visible()}>
                                {(entry, i) => (
                                    <div
                                        class={[
                                            styles.entry,
                                            styles[entryType(entry())],
                                            range().start + i === 0 ? styles.firstEntry : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                    >
                                        {renderPrefix(entryType(entry()))}
                                        <div class={styles.content}>
                                            {renderEntryContent(entryContent(entry()))}
                                        </div>
                                    </div>
                                )}
                            </Index>
                        </div>
                    </div>
                </Show>

                {local.children}

                <Show when={local.empty && items().length === 0 && !local.text}>
                    <div class={styles.empty}>{local.empty}</div>
                </Show>
            </div>

            <Show when={local.showInput !== false}>
            <div class={styles.inputArea}>
                <form class={styles.inputForm} onSubmit={handleFormSubmit}>
                    <PaperInput
                        ref={inputRef}
                        fullWidth
                        compact
                        class={styles.consoleInput}
                        icon={local.prompt ?? "chevron_right"}
                        placeholder={local.placeholder ?? "Enter command..."}
                        disabled={local.inputDisabled}
                        value={local.value !== undefined ? local.value : inputValue()}
                        onInput={(e) => {
                            const val = e.currentTarget.value;
                            if (local.value === undefined) {
                                setInputValue(val);
                            }
                            local.onInputChange?.(val);
                        }}
                        onKeyDown={handleKeyDown}
                    />
                </form>
            </div>
            </Show>
        </div>
    );
}
