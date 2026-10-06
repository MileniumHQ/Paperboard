import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { PaperButton, PaperCopyButton, PaperIcon, PaperMarkdown, PaperModal, PaperText } from "@mileniumhq/paperui";
import { compactCount, isRoundEmpty, replyText, turnStats } from "../core/chain";
import type { AssistantMessage, UserMessage as UserMessageData } from "../core/types";
import { errorText, rewindOpen } from "../lib/state";
import { ActionSteps, ThinkingStep } from "./ReasoningChain";
import styles from "./MessageView.module.css";

function Round(props: { round: AssistantMessage }) {
    return (
        <>
            {/* one step from "waiting" through "thinking" to "thought process",
                so the loader keeps its place instead of jumping between rows */}
            <Show when={Boolean(props.round.thinking) || (props.round.status === "streaming" && isRoundEmpty(props.round))}>
                <ThinkingStep round={props.round} />
            </Show>
            <Show when={props.round.content}>
                <PaperMarkdown text={props.round.content} />
            </Show>
            <ActionSteps round={props.round} />
        </>
    );
}

/**
 * One reply to one prompt. A reply that invokes actions spans several
 * stored rounds; they read as one answer, and only the last round's outcome
 * (done, stopped, failed) closes it.
 */
export function AssistantTurn(props: { rounds: AssistantMessage[] }) {
    const last = () => props.rounds[props.rounds.length - 1]!;
    const stats = () => turnStats(props.rounds);
    const text = () => replyText(props.rounds);
    return (
        <article class={styles.assistant} data-selectable="true" aria-label="AI reply" aria-busy={last().status === "streaming"}>
            <For each={props.rounds}>{(round) => <Round round={round} />}</For>
            <Show when={text() || last().status !== "streaming"}>
                <div class={styles.turnFooter}>
                    <Show when={text()}>
                        <PaperCopyButton text={text()} title="Copy reply" aria-label="Copy reply" />
                    </Show>
                    <Switch>
                        <Match when={last().status === "error"}>
                            <PaperText size={2} color="danger" role="alert">
                                <PaperIcon zeroHeight>error</PaperIcon> {last().error || "The reply failed."}
                            </PaperText>
                        </Match>
                        <Match when={last().status === "stopped"}>
                            <PaperText size={1} color="text-muted">{last().error === "Interrupted" ? "Interrupted" : "Stopped"}</PaperText>
                        </Match>
                        <Match when={last().status === "done" && stats()}>
                            {(s) => (
                                <PaperText size={1} color="text-faint">
                                    {last().model} · {s().tokensPerSecond} tokens/s · {compactCount(s().tokens)} tokens
                                    <Show when={s().contextLength}>
                                        {" "}· {compactCount(s().contextUsed!)} / {compactCount(s().contextLength!)} context (
                                        {Math.round((s().contextUsed! / s().contextLength!) * 100)}%)
                                    </Show>
                                </PaperText>
                            )}
                        </Match>
                    </Switch>
                </div>
            </Show>
        </article>
    );
}

/** "14:05" today, "Sep 26, 14:05" before. */
function sentAt(ms: number): string {
    const d = new Date(ms);
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return time;
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** Long prompts start clamped; the toggle appears only when one overflows. */
export function UserMessage(props: { message: UserMessageData }) {
    const [expanded, setExpanded] = createSignal(false);
    const [overflowing, setOverflowing] = createSignal(false);
    let body: HTMLDivElement | undefined;

    createEffect(() => {
        const open = expanded();
        props.message.content;
        // while expanded the clamped height no longer exists to measure, so
        // the last measurement is kept and the toggle stays available
        if (open) return;
        queueMicrotask(() => {
            if (body) setOverflowing(body.scrollHeight > body.clientHeight + 4);
        });
    });

    const attachments = () => props.message.attachments ?? [];
    const [confirming, setConfirming] = createSignal(false);
    const [undoing, setUndoing] = createSignal(false);
    const [undoError, setUndoError] = createSignal("");

    const undo = async () => {
        setUndoing(true);
        setUndoError("");
        try {
            await rewindOpen(props.message.id);
            setConfirming(false);
        } catch (err) {
            setUndoError(errorText(err));
        } finally {
            setUndoing(false);
        }
    };

    return (
        <div class={styles.userRow}>
            <div class={styles.user} aria-label="Your message">
                <Show when={attachments().length > 0}>
                    <div class={styles.attachments}>
                        <For each={attachments()}>
                            {(a) =>
                                a.kind === "image" && a.dataUrl ? (
                                    <img class={styles.attachmentImage} src={a.dataUrl} alt={a.name} title={a.name} />
                                ) : (
                                    <span class={styles.attachmentFile} title={a.name}>
                                        <PaperIcon zeroHeight>description</PaperIcon>
                                        <span class={styles.attachmentName}>{a.name}</span>
                                    </span>
                                )
                            }
                        </For>
                    </div>
                </Show>
                <div ref={body} classList={{ [styles.userBody!]: true, [styles.clamped!]: !expanded() }}>
                    <PaperText size={2} breakWord class={styles.userText}>{props.message.content}</PaperText>
                </div>
                <Show when={overflowing() || expanded()}>
                    <button
                        type="button"
                        class={styles.showMore}
                        aria-expanded={expanded()}
                        onClick={() => setExpanded(!expanded())}
                    >
                        {expanded() ? "Show less" : "Show more"}
                    </button>
                </Show>
            </div>
            <div class={styles.userMeta}>
                <PaperText size={1} color="text-faint">
                    <time dateTime={new Date(props.message.createdAt).toISOString()}>{sentAt(props.message.createdAt)}</time>
                </PaperText>
                <span class={styles.userActions}>
                    <PaperCopyButton
                        variant="text"
                        text={props.message.content}
                        title="Copy message"
                        aria-label="Copy message"
                    />
                    <PaperButton
                        icon
                        size="tiny"
                        variant="text"
                        aria-label="Undo to before this message"
                        title="Undo to before this message"
                        onClick={() => setConfirming(true)}
                    >
                        undo
                    </PaperButton>
                </span>
            </div>
            <PaperModal
                open={confirming()}
                onClose={() => setConfirming(false)}
                title="Undo to before this message?"
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setConfirming(false)}>Cancel</PaperButton>
                        <PaperButton variant="danger" disabled={undoing()} onClick={() => void undo()}>
                            Erase
                        </PaperButton>
                    </>
                }
            >
                <PaperText>
                    This message and everything after it are erased from the chat. A reply still being written is stopped. This cannot be undone.
                </PaperText>
                <Show when={undoError()}>
                    <PaperText color="danger" role="alert">{undoError()}</PaperText>
                </Show>
            </PaperModal>
        </div>
    );
}
