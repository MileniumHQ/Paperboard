// The run log: a card in the dock under the canvas, there while it has
// lines, newest at the bottom and kept in view.
import { createEffect, For, on, Show } from "solid-js";
import { PaperButton, PaperIcon, PaperText } from "@mileniumhq/paperui";
import type { LogEntry } from "./panel";
import styles from "./Console.module.css";

/** a reader within this many pixels of the end is at the end (scroll positions are fractions) */
const BOTTOM_SLACK = 4;

export function Console(props: { entries: LogEntry[]; onClear(): void }) {
    let body: HTMLDivElement | undefined;
    // The newest line is the point, so a reader at the bottom stays there as lines arrive. One who scrolled up
    // to read stays where they are, until they come back down.
    let following = true;
    const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    createEffect(
        on(
            () => props.entries.length,
            () =>
                queueMicrotask(() => {
                    if (body && following) body.scrollTop = body.scrollHeight;
                }),
        ),
    );

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
                <div
                    class={styles.body}
                    ref={(el) => {
                        body = el;
                        following = true;
                    }}
                    onScroll={(e) => (following = atBottom(e.currentTarget))}
                >
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
