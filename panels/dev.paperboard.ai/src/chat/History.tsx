// Past conversations: open one to continue it (the current one takes its
// place in the list), or delete one for good after saying so.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperLoader, PaperModal, PaperText } from "@mileniumhq/paperui";
import type { PastConversation } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./History.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function History(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const [list, setList] = createSignal<PastConversation[] | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [deleting, setDeleting] = createSignal<PastConversation | null>(null);

    const load = async () => {
        setError(null);
        setList(null);
        try {
            setList(await props.agent.conversations());
        } catch (e) {
            setError(message(e));
        }
    };

    // read afresh each time it opens: the agent may have started or reopened one meanwhile
    createEffect(on(() => props.open, (open) => open && void load()));

    const act = async (run: () => Promise<unknown>, after: () => void) => {
        setBusy(true);
        setError(null);
        try {
            await run();
            after();
        } catch (e) {
            setError(message(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PaperModal
                open={props.open}
                onClose={() => !busy() && props.onClose()}
                title="Past conversations"
                size="medium"
            >
                <Switch>
                    <Match when={list() === null && error()}>
                        <PaperEmptyState icon="error" title="The history can't be read" description={error()!}>
                            <PaperButton onClick={() => void load()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </Match>
                    <Match when={list() === null}>
                        <PaperLoader loaderStatus="indeterminate" label="Reading the history" />
                    </Match>
                    <Match when={list()!.length === 0}>
                        <PaperEmptyState icon="history" title="No past conversations" description="Start a new conversation with the plus button, and this one will wait here." />
                    </Match>
                    <Match when={true}>
                        <div class={styles.list}>
                            <For each={list()}>
                                {(c) => (
                                    <div class={styles.row}>
                                        <button
                                            type="button"
                                            class={styles.item}
                                            disabled={busy()}
                                            onClick={() => void act(() => props.agent.openConversation(c.id), props.onClose)}
                                        >
                                            <PaperText class={styles.title}>{c.title}</PaperText>
                                            <PaperText size={1} color="muted">
                                                {when(c.endedAt)} · {c.messages === 1 ? "1 message" : `${c.messages} messages`}
                                            </PaperText>
                                        </button>
                                        <PaperButton icon size="small" variant="text" disabled={busy()} aria-label={`Delete “${c.title}”`} title="Delete" onClick={() => setDeleting(c)}>
                                            <PaperIcon>delete</PaperIcon>
                                        </PaperButton>
                                    </div>
                                )}
                            </For>
                            <Show when={error()}>
                                <PaperText size={1} color="danger" role="alert">
                                    {error()}
                                </PaperText>
                            </Show>
                        </div>
                    </Match>
                </Switch>
            </PaperModal>
            <PaperModal
                open={deleting() !== null}
                onClose={() => !busy() && setDeleting(null)}
                title="Delete this conversation?"
                size="small"
                footer={
                    <>
                        <PaperButton disabled={busy()} onClick={() => setDeleting(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={() => {
                                const c = deleting()!;
                                void act(
                                    () => props.agent.deleteConversation(c.id),
                                    () => {
                                        setDeleting(null);
                                        setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
                                    },
                                );
                            }}
                        >
                            Delete
                        </PaperButton>
                    </>
                }
            >
                <PaperText>“{deleting()?.title}” is deleted for good. What the agent remembers from it stays in its memory.</PaperText>
                <Show when={error()}>
                    <PaperText size={1} color="danger" role="alert">
                        {error()}
                    </PaperText>
                </Show>
            </PaperModal>
        </>
    );
}
