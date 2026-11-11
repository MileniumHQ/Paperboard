// The run log, as the Actions canvas shows its console: a glass panel in
// the canvas's top-right corner, there while it has lines, newest at the
// bottom and kept in view.
import { createEffect, For, Show } from "solid-js";
import { PaperButton, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { LogEntry } from "./panel";
import styles from "./Console.module.css";

export function Console(props: { entries: LogEntry[]; onClear(): void }) {
    let body: HTMLDivElement | undefined;
    // the newest line is the point: a failure never hides below the fold
    createEffect(() => {
        props.entries.length;
        queueMicrotask(() => {
            if (body) body.scrollTop = body.scrollHeight;
        });
    });

    return (
        <Show when={props.entries.length > 0}>
            <div class={styles.panel}>
                <div class={styles.header}>
                    <div class={styles.title}>
                        <PaperIcon class={styles.icon}>terminal</PaperIcon>
                        <PaperText preset="heading">Console</PaperText>
                    </div>
                    <PaperButton size="tiny" icon onClick={() => props.onClear()} title="Clear Console">
                        <PaperIcon>delete_sweep</PaperIcon>
                    </PaperButton>
                </div>
                <div class={styles.body} ref={body}>
                    <For each={props.entries}>
                        {(entry) => (
                            <div class={styles.line} classList={{ [styles.error!]: entry.level === "error" }}>
                                <span class={styles.time}>{new Date(entry.at).toLocaleTimeString()}</span>
                                <span class={styles.text}>{entry.message}</span>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </Show>
    );
}
