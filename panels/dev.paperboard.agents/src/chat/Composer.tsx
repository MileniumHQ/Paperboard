// The message box: a growing text field and a send button, like any messages
// app. Replying to a bubble shows what it answers above the box; files picked
// with the clip, pasted or dropped wait in a tray above it. Everything else
// (the model, the computer) lives in the menu and settings.

import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { PaperButton, PaperEffect, PaperIcon, PaperQuote, haptic } from "@mileniumhq/paperui";
import { LIMITS, type ChatEntry } from "../contract";
import type { Agent } from "../lib/agent";
import { failure, type Failure } from "../lib/failure";
import type { Tray } from "./tray";
import styles from "./Composer.module.css";

export default function Composer(props: {
    agent: Agent;
    draft: string;
    onDraft: (text: string) => void;
    /** the bubble being answered */
    replyTo: Extract<ChatEntry, { kind: "user" | "agent" }> | null;
    /** a message is leaving: the chat goes to its end to show it */
    onSend: () => void;
    replyAuthor: (m: Extract<ChatEntry, { kind: "user" | "agent" }>) => string;
    onCancelReply: () => void;
    tray: Tray;
}) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "your agent";

    const [error, setError] = createSignal<Failure | null>(null);
    const [dragging, setDragging] = createSignal(false);
    let field!: HTMLTextAreaElement;
    let sizer!: HTMLTextAreaElement;
    let picker!: HTMLInputElement;

    const tray = () => props.tray;
    const ready = () => !tray().uploading() && !tray().failed() && (!!props.draft.trim() || tray().ids().length > 0);
    const attach = (files: File[]) => {
        if (!files.length) return;
        const refused = tray().add(files);
        setError(refused ? { title: "Not every file added", message: refused } : null);
    };

    const send = async () => {
        if (!ready()) return;
        const text = props.draft.trim();
        setError(null);
        // felt as the message leaves, not once the service has it
        haptic("send");
        props.onSend();
        try {
            await agent.send(text, props.replyTo?.id, tray().ids());
            props.onDraft("");
            tray().clear();
            props.onCancelReply();
        } catch (e) {
            setError(failure("Message not sent", e));
        }
    };

    // Grows with the text up to its max-height, then scrolls; a sent message clears it from outside.
    // The text is measured in the field's twin, which sits outside the layout. Measuring in the field itself means collapsing it first:
    // for that moment the chat above is taller, the browser moves the chat's scroll to fit, and it doesn't come back.
    // The field's height only ever goes from one length to the next, so it can be eased.
    const resize = () => {
        sizer.style.width = getComputedStyle(field).width;
        sizer.value = field.value;
        field.style.height = `${sizer.scrollHeight}px`;
        // typing at the end keeps the end in view, once the field is as tall as it gets
        if (field.selectionEnd === field.value.length) field.scrollTop = field.scrollHeight;
    };
    createEffect(() => {
        void props.draft;
        queueMicrotask(resize);
    });
    // A button pressed beside the box leaves the cursor in it, so a phone's keyboard stays up.
    // The cursor moves on mousedown, and a finger's tap makes one too; stopping pointerdown only holds it for a mouse.
    const keepFocus = (e: MouseEvent) => {
        if (document.activeElement === field) e.preventDefault();
    };
    // The clip opens the system's picker, which on a phone takes the whole screen. If the cursor was in the box and the picker took it,
    // it goes back in once the picker has closed, with files or without, and the page is in front again.
    let typing = false;
    const resume = () => field.focus();
    const pick = () => {
        typing = document.activeElement === field;
        picker.click();
    };
    const picked = () => {
        if (!typing) return;
        typing = false;
        // a phone can report its picker closed before the page is in front again
        if (document.hasFocus()) resume();
        else window.addEventListener("focus", resume, { once: true });
    };
    onCleanup(() => window.removeEventListener("focus", resume));
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
                        picked();
                    }}
                    on:cancel={picked}
                />
                <PaperButton icon size="small" variant="text" aria-label="Attach files" title="Attach files" onMouseDown={keepFocus} onClick={pick}>
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
                    onInput={(e) => props.onDraft(e.currentTarget.value)}
                    onPaste={(e) => {
                        const files = [...(e.clipboardData?.files ?? [])];
                        if (!files.length) return;
                        e.preventDefault();
                        attach(files);
                    }}
                    onKeyDown={(e) => {
                        // Enter breaks the line, like a phone's keyboard; the send button sends, and so does Ctrl or Cmd+Enter
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
                            e.preventDefault();
                            void send();
                        }
                        if (e.key === "Escape" && props.replyTo) props.onCancelReply();
                    }}
                />
                <textarea ref={sizer} class={`${styles.field} ${styles.sizer}`} aria-hidden="true" tabIndex={-1} readOnly />
                <PaperEffect variant="primary" disabled={!ready()}>
                    <PaperButton
                        icon
                        size="small"
                        variant="primary"
                        disabled={!ready()}
                        onMouseDown={keepFocus}
                        onClick={() => void send()}
                        aria-label="Send"
                        title={tray().uploading() ? "Waiting for files to upload" : tray().failed() ? "Remove the files that didn't upload" : "Send"}
                    >
                        arrow_upward
                    </PaperButton>
                </PaperEffect>
            </div>

            <Show when={error()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert" onDismiss={() => setError(null)}>
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
        </div>
    );
}
