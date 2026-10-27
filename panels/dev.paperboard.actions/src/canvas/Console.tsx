// The canvas console: what flow runs logged, and every run that failed.
import { For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { PaperButton, PaperIcon, PaperText } from "@mileniumhq/paperui";
import "./Console.css";

// console log ring: newest entries win, oldest drop past the cap
const MAX_CONSOLE_LOGS = 500;

export interface ConsoleEntry {
    id: string;
    time: string;
    message: string;
    level?: "error";
}

export type ConsoleLog = ReturnType<typeof createConsoleLog>;

export function createConsoleLog() {
    const [entries, setEntries] = createStore<ConsoleEntry[]>([]);
    let body: HTMLDivElement | undefined;

    const append = (entry: Omit<ConsoleEntry, "id">) => {
        // bounded: a long flow-test session must not grow this store forever
        setEntries((prev) => {
            const next = [
                ...prev,
                { id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, ...entry },
            ];
            return next.length > MAX_CONSOLE_LOGS ? next.slice(next.length - MAX_CONSOLE_LOGS) : next;
        });
        // the newest line is the point: scroll there on every append so a
        // failure can never hide below the fold
        queueMicrotask(() => {
            if (body) body.scrollTop = body.scrollHeight;
        });
    };

    /** A failure, stamped now. */
    const error = (message: string) =>
        append({ time: new Date().toLocaleTimeString(), message, level: "error" });

    return {
        entries,
        append,
        error,
        clear: () => setEntries([]),
        setBody: (el: HTMLDivElement) => { body = el; },
    };
}

export default function ConsolePanel(props: { log: ConsoleLog }) {
    return (
        <Show when={props.log.entries.length > 0}>
            <div class="canvas-console-panel">
                <div class="canvas-console-header">
                    <div class="canvas-console-title">
                        <PaperIcon class="canvas-console-icon">terminal</PaperIcon>
                        <PaperText size={1} weight={700}>Console</PaperText>
                    </div>
                    <PaperButton size="tiny" icon onClick={() => props.log.clear()} title="Clear Console">
                        <PaperIcon>delete_sweep</PaperIcon>
                    </PaperButton>
                </div>
                <div class="canvas-console-body" ref={props.log.setBody}>
                    <For each={props.log.entries}>
                        {(entry) => (
                            <div class="canvas-console-line" classList={{ "is-error": entry.level === "error" }}>
                                <span class="canvas-console-time">{entry.time}</span>
                                <span class="canvas-console-text">{entry.message}</span>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </Show>
    );
}
