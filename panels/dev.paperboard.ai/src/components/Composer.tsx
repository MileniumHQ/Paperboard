import { createSignal, For, Show } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperIcon,
    PaperText,
    useContextMenuState,
} from "@paperboard-dev/paperui";
import { MAX_ATTACHMENTS } from "../core/attachments";
import { REASONING_LABELS, REASONING_LEVELS, type ReasoningLevel } from "../core/reasoning";
import type { Attachment } from "../core/types";
import { attachmentsFromFiles } from "../lib/attachments";
import { makerOf } from "../lib/catalog";
import { errorText } from "../lib/state";
import MakerLogo from "./MakerLogo";
import MessageInput from "./MessageInput";
import styles from "./Composer.module.css";

export interface ComposerProps {
    disabled: boolean;
    disabledReason?: string;
    generating: boolean;
    canThink: boolean;
    /** the current chat's model, or the default when the chat is empty */
    model: string;
    modelReady: boolean;
    reasoning: ReasoningLevel;
    onOpenModels: () => void;
    onReasoningChange: (level: ReasoningLevel) => void;
    onSend: (text: string, reasoning: ReasoningLevel, attachments: Attachment[]) => Promise<boolean>;
    onStop: () => void;
}

/** Enter sends, Shift+Enter adds a line. Files attach by paperclip, drop, or paste. */
export default function Composer(props: ComposerProps) {
    const [text, setText] = createSignal("");
    const [sending, setSending] = createSignal(false);
    const [attachments, setAttachments] = createSignal<Attachment[]>([]);
    const [attachError, setAttachError] = createSignal("");
    const [dragging, setDragging] = createSignal(false);
    const reasoningMenu = useContextMenuState("below");
    let input: HTMLTextAreaElement | undefined;
    let reasoningButton: HTMLButtonElement | undefined;
    let picker: HTMLInputElement | undefined;

    const canSend = () => !props.disabled && !props.generating && !sending() && (text().trim() !== "" || attachments().length > 0);

    const addFiles = async (files: Iterable<File>) => {
        setAttachError("");
        const list = [...files];
        if (list.length === 0) return;
        const room = MAX_ATTACHMENTS - attachments().length;
        if (room <= 0) {
            setAttachError(`At most ${MAX_ATTACHMENTS} files can be attached to one message.`);
            return;
        }
        try {
            const added = await attachmentsFromFiles(list.slice(0, room));
            setAttachments((prev) => [...prev, ...added].slice(0, MAX_ATTACHMENTS));
            if (list.length > room) setAttachError(`Only the first ${MAX_ATTACHMENTS} files were attached.`);
        } catch (err) {
            setAttachError(errorText(err));
        }
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
        setAttachError("");
    };

    const send = async () => {
        if (!canSend()) return;
        setSending(true);
        setAttachError("");
        try {
            const ok = await props.onSend(text().trim(), props.reasoning, attachments());
            if (ok) {
                setText("");
                setAttachments([]);
            }
        } finally {
            setSending(false);
            input?.focus();
        }
    };

    return (
        <div class={styles.Composer}>
            <div
                class={styles.box}
                classList={{ [styles.dragging!]: dragging() }}
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={(e) => {
                    if (e.currentTarget === e.target) setDragging(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void addFiles(e.dataTransfer?.files ?? []);
                }}
            >
                <Show when={attachments().length > 0}>
                    <div class={styles.attachments}>
                        <For each={attachments()}>
                            {(a) => (
                                <div class={styles.chip}>
                                    <Show when={a.kind === "image" && a.dataUrl} fallback={<PaperIcon class={styles.chipIcon}>description</PaperIcon>}>
                                        <img src={a.dataUrl} alt="" class={styles.thumb} />
                                    </Show>
                                    <span class={styles.chipName} title={a.name}>{a.name}</span>
                                    <PaperButton
                                        icon
                                        size="tiny"
                                        variant="text"
                                        aria-label={`Remove ${a.name}`}
                                        onClick={() => removeAttachment(a.id)}
                                    >
                                        close
                                    </PaperButton>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                <MessageInput
                    ref={(el) => (input = el)}
                    value={text()}
                    disabled={props.disabled}
                    placeholder="Ask for changes, send follow-ups, or attach images"
                    onInput={setText}
                    onPaste={(e) => {
                        const files = [...(e.clipboardData?.files ?? [])];
                        if (files.length > 0) {
                            e.preventDefault();
                            void addFiles(files);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                            e.preventDefault();
                            void send();
                        }
                    }}
                />

                <div class={styles.controls}>
                    <button
                        type="button"
                        class={styles.model}
                        onClick={props.onOpenModels}
                        title={props.modelReady ? props.model : "Choose a model"}
                        aria-label={props.model ? `Model: ${props.model}` : "Select a model"}
                    >
                        <Show when={props.model} fallback={<PaperIcon class={styles.modelIcon}>add</PaperIcon>}>
                            <MakerLogo icon={makerOf(props.model)?.icon} size="small" />
                        </Show>
                        <span class={styles.modelName}>{props.model || "Select Model"}</span>
                    </button>

                    <Show when={props.canThink}>
                        <button
                            ref={reasoningButton}
                            type="button"
                            class={styles.reasoning}
                            disabled={props.disabled}
                            aria-haspopup="menu"
                            aria-expanded={reasoningMenu.isOpen()}
                            aria-label={`Reasoning: ${REASONING_LABELS[props.reasoning]}`}
                            onClick={() => reasoningMenu.openBelow(reasoningButton!)}
                        >
                            <span>{REASONING_LABELS[props.reasoning]}</span>
                            <PaperIcon class={styles.reasoningChevron}>expand_more</PaperIcon>
                        </button>
                    </Show>

                    <span class={styles.spacer} />

                    <input
                        ref={picker}
                        type="file"
                        multiple
                        hidden
                        aria-hidden="true"
                        tabindex={-1}
                        onChange={(e) => {
                            void addFiles(e.currentTarget.files ?? []);
                            e.currentTarget.value = "";
                        }}
                    />
                    <PaperButton
                        icon
                        size="small"
                        variant="text"
                        class={styles.attach}
                        aria-label="Attach files"
                        title="Attach files"
                        disabled={props.disabled}
                        onClick={() => picker?.click()}
                    >
                        attach_file
                    </PaperButton>

                    <Show
                        when={props.generating}
                        fallback={
                            <PaperEffect variant="primary" disabled={!canSend()}>
                                <PaperButton icon size="small" variant="primary" disabled={!canSend()} onClick={send} aria-label="Send message">
                                    arrow_upward
                                </PaperButton>
                            </PaperEffect>
                        }
                    >
                        <PaperEffect variant="danger">
                            <PaperButton icon size="small" variant="danger" onClick={props.onStop} aria-label="Stop the reply">
                                stop
                            </PaperButton>
                        </PaperEffect>
                    </Show>
                </div>

                <Show when={attachError()}>
                    <PaperText size={1} color="danger" role="alert">{attachError()}</PaperText>
                </Show>
            </div>
            <Show when={props.disabled && props.disabledReason}>
                <PaperText size={1} color="text-muted" class={styles.reason}>
                    <PaperIcon zeroHeight>info</PaperIcon> {props.disabledReason}
                </PaperText>
            </Show>

            <PaperContextMenu
                open={reasoningMenu.isOpen()}
                target={reasoningMenu.target()}
                placement={reasoningMenu.placement()}
                onClose={reasoningMenu.close}
            >
                <For each={REASONING_LEVELS}>
                    {(level) => (
                        <PaperContextMenuItem
                            value={level}
                            icon={props.reasoning === level ? "check" : undefined}
                            onClick={() => {
                                props.onReasoningChange(level);
                                reasoningMenu.close();
                            }}
                        >
                            {REASONING_LABELS[level]}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>
        </div>
    );
}
