import { createSignal, For, Show, type JSX } from "solid-js";
import {
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperIcon,
    PaperText,
    useContextMenuState,
} from "@mileniumhq/paperui";
import { MAX_ATTACHMENTS } from "../core/attachments";
import { effortLabel, REASONING_LABELS, REASONING_LEVELS, type ReasoningLevel } from "../core/reasoning";
import { commandSuggestions } from "../core/agents";
import type { AgentCommand, AgentMode, Attachment } from "../core/types";
import { attachmentsFromFiles } from "../lib/attachments";
import { makerOf } from "../lib/catalog";
import { errorText } from "../lib/state";
import AgentLogo from "./AgentLogo";
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
    /** a coding agent's slash commands, suggested while typing one */
    commands?: AgentCommand[];
    placeholder?: string;
    /** shown above the message box (a coding agent's project) */
    toolbar?: JSX.Element;
    /** a coding agent model's own thinking levels, shown instead of Local AI's; none picked runs the agent's default */
    efforts?: { levels: string[]; current: string | undefined };
    onEffortChange?: (level: string) => void;
    /** a coding agent chat's permission modes, picked next to the reasoning level */
    modes?: { modes: AgentMode[]; current: AgentMode | undefined };
    modeDisabled?: boolean;
    onModeChange?: (mode: string) => void;
    /** a coding agent chat: its agent, whose logo stands for the model */
    agent?: string;
}


/** Enter sends, Shift+Enter adds a line. Files attach by paperclip, drop, or paste. */
export default function Composer(props: ComposerProps) {
    const [text, setText] = createSignal("");
    const [sending, setSending] = createSignal(false);
    const [attachments, setAttachments] = createSignal<Attachment[]>([]);
    const [attachError, setAttachError] = createSignal("");
    const [dragging, setDragging] = createSignal(false);
    const reasoningMenu = useContextMenuState("below");
    const modeMenu = useContextMenuState("below");
    let input: HTMLTextAreaElement | undefined;
    let reasoningButton: HTMLButtonElement | undefined;
    let modeButton: HTMLButtonElement | undefined;
    const levelName = () => {
        if (!props.efforts) return REASONING_LABELS[props.reasoning];
        const current = props.efforts.current;
        return current ? effortLabel(current) : "Default";
    };
    let picker: HTMLInputElement | undefined;

    const suggestions = () => commandSuggestions(text(), props.commands ?? []);
    const complete = (c: AgentCommand) => {
        setText(`/${c.name} `);
        input?.focus();
    };
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
            {props.toolbar}
            <Show when={suggestions().length > 0}>
                <ul class={styles.commands} aria-label="Agent commands">
                    <For each={suggestions()}>
                        {(c) => (
                            <li>
                                <button type="button" class={styles.command} onClick={() => complete(c)}>
                                    <span class={styles.commandName}>/{c.name}</span>
                                    <span class={styles.commandDescription}>{c.description}{c.hint ? ` (${c.hint})` : ""}</span>
                                </button>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
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
                    placeholder={props.placeholder ?? "Ask anything"}
                    onInput={setText}
                    onPaste={(e) => {
                        const files = [...(e.clipboardData?.files ?? [])];
                        if (files.length > 0) {
                            e.preventDefault();
                            void addFiles(files);
                        }
                    }}
                    onKeyDown={(e) => {
                        // Tab takes the first suggested command
                        if (e.key === "Tab" && !e.shiftKey && suggestions().length > 0) {
                            e.preventDefault();
                            complete(suggestions()[0]!);
                            return;
                        }
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
                            <Show when={props.agent} fallback={<MakerLogo icon={makerOf(props.model)?.icon} size="small" />}>
                                <span class={styles.agentLogo}><AgentLogo agent={props.agent} /></span>
                            </Show>
                        </Show>
                        <span class={styles.modelName}>{props.model || "Select Model"}</span>
                    </button>

                    <Show when={props.efforts || props.canThink}>
                        <button
                            ref={reasoningButton}
                            type="button"
                            class={styles.picker}
                            disabled={props.disabled}
                            aria-haspopup="menu"
                            aria-expanded={reasoningMenu.isOpen()}
                            aria-label={`Reasoning: ${levelName()}`}
                            onClick={() => reasoningMenu.openBelow(reasoningButton!)}
                        >
                            <span>{levelName()}</span>
                            <PaperIcon class={styles.pickerChevron}>expand_more</PaperIcon>
                        </button>
                    </Show>

                    <Show when={props.modes}>
                        {(picker) => (
                            <button
                                ref={modeButton}
                                data-mode-picker
                                type="button"
                                class={styles.picker}
                                disabled={props.modeDisabled}
                                title={picker().current?.description}
                                aria-haspopup="menu"
                                aria-expanded={modeMenu.isOpen()}
                                aria-label={`Mode: ${picker().current?.name ?? "not set"}`}
                                onClick={() => modeMenu.openBelow(modeButton!)}
                            >
                                <span>{picker().current?.name ?? "Mode"}</span>
                                <PaperIcon class={styles.pickerChevron}>expand_more</PaperIcon>
                            </button>
                        )}
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
                <Show
                    when={props.efforts}
                    fallback={
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
                    }
                >
                    {(efforts) => (
                        <For each={efforts().levels}>
                            {(level) => (
                                <PaperContextMenuItem
                                    value={level}
                                    icon={efforts().current === level ? "check" : undefined}
                                    onClick={() => {
                                        props.onEffortChange?.(level);
                                        reasoningMenu.close();
                                    }}
                                >
                                    {effortLabel(level)}
                                </PaperContextMenuItem>
                            )}
                        </For>
                    )}
                </Show>
            </PaperContextMenu>

            <PaperContextMenu
                open={modeMenu.isOpen()}
                target={modeMenu.target()}
                placement={modeMenu.placement()}
                onClose={modeMenu.close}
            >
                <For each={props.modes?.modes ?? []}>
                    {(mode) => (
                        <PaperContextMenuItem
                            value={mode.id}
                            description={mode.description}
                            icon={props.modes?.current?.id === mode.id ? "check" : undefined}
                            onClick={() => {
                                props.onModeChange?.(mode.id);
                                modeMenu.close();
                            }}
                        >
                            {mode.name}
                        </PaperContextMenuItem>
                    )}
                </For>
            </PaperContextMenu>
        </div>
    );
}
