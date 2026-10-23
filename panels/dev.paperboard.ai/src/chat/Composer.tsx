// The message box: a growing text field and a send button, like any messages
// app. Replying to a bubble shows what it answers above the box. Everything
// else (the model, the computer) lives in the menu and settings.

import { Show, createEffect, createSignal } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperText } from "@mileniumhq/paperui";
import { LIMITS, type ChatEntry } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./Composer.module.css";

const MAX_HEIGHT = "calc(var(--paper-uigap) * 12)";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Composer(props: {
    agent: Agent;
    draft: string;
    onDraft: (text: string) => void;
    /** the bubble being answered */
    replyTo: Extract<ChatEntry, { kind: "user" | "agent" }> | null;
    replyAuthor: (m: Extract<ChatEntry, { kind: "user" | "agent" }>) => string;
    onCancelReply: () => void;
}) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "your agent";

    const [error, setError] = createSignal<string | null>(null);
    let field!: HTMLTextAreaElement;

    const send = async () => {
        const text = props.draft.trim();
        if (!text) return;
        setError(null);
        try {
            await agent.send(text, props.replyTo?.id);
            props.onDraft("");
            props.onCancelReply();
        } catch (e) {
            setError(message(e));
        }
    };

    // grows with the text up to a bound; a sent message clears it from outside
    const resize = () => {
        field.style.height = "auto";
        field.style.height = `min(${field.scrollHeight}px, ${MAX_HEIGHT})`;
    };
    createEffect(() => {
        void props.draft;
        queueMicrotask(resize);
    });
    // choosing to reply puts the cursor in the box
    createEffect(() => {
        if (props.replyTo) field.focus();
    });

    return (
        <div class={styles.Composer}>
            <Show when={props.replyTo}>
                {(to) => (
                    <div class={styles.reply}>
                        <PaperIcon class={styles.replyIcon}>reply</PaperIcon>
                        <div class={styles.replyBody}>
                            <span class={styles.replyWho}>Replying to {props.replyAuthor(to())}</span>
                            <span class={styles.replyText}>{to().text}</span>
                        </div>
                        <PaperButton icon size="tiny" variant="text" aria-label="Cancel reply" title="Cancel reply" onClick={props.onCancelReply}>
                            close
                        </PaperButton>
                    </div>
                )}
            </Show>

            <div class={styles.box}>
                <textarea
                    ref={field}
                    class={styles.field}
                    rows={1}
                    value={props.draft}
                    maxLength={LIMITS.message}
                    placeholder={`Message ${name()}`}
                    aria-label={`Message ${name()}`}
                    onInput={(e) => {
                        props.onDraft(e.currentTarget.value);
                        resize();
                    }}
                    onKeyDown={(e) => {
                        // Enter sends, Shift+Enter breaks the line
                        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                            e.preventDefault();
                            void send();
                        }
                        if (e.key === "Escape" && props.replyTo) props.onCancelReply();
                    }}
                />
                <PaperEffect variant="primary" disabled={!props.draft.trim()}>
                    <PaperButton icon size="small" variant="primary" disabled={!props.draft.trim()} onClick={() => void send()} aria-label="Send" title="Send">
                        arrow_upward
                    </PaperButton>
                </PaperEffect>
            </div>

            <Show when={error()}>
                <PaperText size={1} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
        </div>
    );
}
