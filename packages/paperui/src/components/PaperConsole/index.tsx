import styles from "./index.module.css";
import {
    createSignal,
    createEffect,
    splitProps,
    Show,
    For,
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
    let inputRef: HTMLInputElement | undefined;

    const [local, rest] = splitProps(props, [
        "entries",
        "onCommand",
        "title",
        "onClear",
        "showInput",
        "text",
        "banner",
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

    const scrollToBottom = () => {
        if (local.autoScroll !== false && outputRef) {
            outputRef.scrollTop = outputRef.scrollHeight;
        }
    };

    createEffect(() => {
        if (local.entries || local.children || local.text) {
            setTimeout(scrollToBottom, 0);
        }
    });

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
        setTimeout(scrollToBottom, 0);
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

    const normalizedEntries = (): PaperConsoleEntry[] => {
        if (!local.entries) return [];
        return local.entries.map((entry, idx) => {
            if (typeof entry === "string") {
                return {
                    id: idx,
                    type: "output",
                    content: entry,
                };
            }
            return {
                id: entry.id ?? idx,
                type: entry.type ?? "output",
                content: entry.content,
                timestamp: entry.timestamp,
            };
        });
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

            <div ref={outputRef} class={styles.outputArea}>
                <Show when={local.banner}>
                    <div class={styles.banner}>{local.banner}</div>
                </Show>

                <Show when={local.text !== undefined}>
                    <pre class={styles.textBody}>{local.text}</pre>
                </Show>

                <For each={normalizedEntries()}>
                    {(entry) => (
                        <div
                            class={[
                                styles.entry,
                                styles[entry.type ?? "output"],
                            ]
                                .filter(Boolean)
                                .join(" ")}
                        >
                            {renderPrefix(entry.type)}
                            <div class={styles.content}>
                                {renderEntryContent(entry.content)}
                            </div>
                        </div>
                    )}
                </For>

                {local.children}
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
