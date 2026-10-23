// The message box: a growing text field and a send button, like any messages
// app. Replying to a bubble shows what it answers above the box; files picked
// with the clip, pasted or dropped wait in a tray above it. Everything else
// (the model, the computer) lives in the menu and settings.

import { For, Show, createEffect, createSignal } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperText } from "@mileniumhq/paperui";
import { LIMITS, type ChatEntry } from "../contract";
import type { Agent } from "../lib/agent";
import type { Tray } from "./tray";
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
    tray: Tray;
}) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "your agent";

    const [error, setError] = createSignal<string | null>(null);
    const [dragging, setDragging] = createSignal(false);
    let field!: HTMLTextAreaElement;
    let picker!: HTMLInputElement;

    const tray = () => props.tray;
    const ready = () => !tray().uploading() && !tray().failed() && (!!props.draft.trim() || tray().ids().length > 0);
    const attach = (files: File[]) => {
        if (files.length) setError(tray().add(files));
    };

    const send = async () => {
        if (!ready()) return;
        const text = props.draft.trim();
        setError(null);
        try {
            await agent.send(text, props.replyTo?.id, tray().ids());
            props.onDraft("");
            tray().clear();
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

            <Show when={tray().chips().length}>
                <ul class={styles.tray} aria-label="Files to send">
                    <For each={tray().chips()}>
                        {(chip) => (
                            <li class={styles.chip} classList={{ [styles.chipFailed!]: !!chip.error }} title={chip.error ?? chip.name}>
                                <Show when={chip.preview && chip.kind === "image"} fallback={<PaperIcon class={styles.chipIcon}>{chip.kind === "video" ? "movie" : chip.error ? "error" : "description"}</PaperIcon>}>
                                    <img class={styles.chipThumb} src={chip.preview!} alt="" />
                                </Show>
                                <span class={styles.chipName}>{chip.error ? `${chip.name}: ${chip.error}` : chip.name}</span>
                                <Show when={!chip.file && !chip.error}>
                                    <progress class={styles.chipProgress} value={chip.progress} max={1} aria-label={`Uploading ${chip.name}`} />
                                </Show>
                                <PaperButton icon size="tiny" variant="text" aria-label={`Remove ${chip.name}`} title="Remove" onClick={() => tray().remove(chip.key)}>
                                    close
                                </PaperButton>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>

            <div
                class={styles.box}
                classList={{ [styles.dragging!]: dragging() }}
                onDragOver={(e) => {
                    if (!e.dataTransfer?.types.includes("Files")) return;
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(e) => {
                    setDragging(false);
                    if (!e.dataTransfer?.files.length) return;
                    e.preventDefault();
                    attach([...e.dataTransfer.files]);
                }}
            >
                <input
                    ref={picker}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                        attach([...(e.currentTarget.files ?? [])]);
                        e.currentTarget.value = "";
                    }}
                />
                <PaperButton icon size="small" variant="text" aria-label="Attach files" title="Attach files" onClick={() => picker.click()}>
                    attach_file
                </PaperButton>
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
                    onPaste={(e) => {
                        const files = [...(e.clipboardData?.files ?? [])];
                        if (!files.length) return;
                        e.preventDefault();
                        attach(files);
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
                <PaperEffect variant="primary" disabled={!ready()}>
                    <PaperButton
                        icon
                        size="small"
                        variant="primary"
                        disabled={!ready()}
                        onClick={() => void send()}
                        aria-label="Send"
                        title={tray().uploading() ? "Waiting for files to upload" : tray().failed() ? "Remove the files that didn't upload" : "Send"}
                    >
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
