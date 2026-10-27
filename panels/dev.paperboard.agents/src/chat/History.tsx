// Past conversations: open one to continue it (the current one takes its
// place in the list), or delete one for good after saying so.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperLoader, PaperMediaCard, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import type { PastConversation } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText, failure, type Failure } from "../lib/failure";
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function History(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const [list, setList] = createSignal<PastConversation[] | null>(null);
    const [readError, setReadError] = createSignal<string | null>(null);
    const [openError, setOpenError] = createSignal<Failure | null>(null);
    const [deleteError, setDeleteError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [deleting, setDeleting] = createSignal<PastConversation | null>(null);

    const load = async () => {
        setReadError(null);
        setOpenError(null);
        setList(null);
        try {
            setList(await props.agent.conversations());
        } catch (e) {
            setReadError(errorText(e));
        }
    };

    // read afresh each time it opens: the agent may have started or reopened one meanwhile
    createEffect(on(() => props.open, (open) => open && void load()));

    const reopen = async (c: PastConversation) => {
        setBusy(true);
        setOpenError(null);
        try {
            await props.agent.openConversation(c.id);
            props.onClose();
        } catch (e) {
            setOpenError(failure("Conversation not opened", e));
        } finally {
            setBusy(false);
        }
    };

    const askDelete = (c: PastConversation) => {
        setDeleteError(null);
        setDeleting(c);
    };

    const remove = async () => {
        const c = deleting()!;
        setBusy(true);
        setDeleteError(null);
        try {
            await props.agent.deleteConversation(c.id);
            setDeleting(null);
            setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
        } catch (e) {
            setDeleteError(errorText(e));
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
                    <Match when={list() === null && readError()}>
                        <PaperEmptyState icon="error" title="The history can't be read" description={readError()!}>
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
                        <PaperFlex gap="half">
                            <Show when={openError()}>
                                {(shown) => (
                                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                        {shown().message}
                                    </PaperQuote>
                                )}
                            </Show>
                            <For each={list()}>
                                {(c) => (
                                    <PaperFlex direction="row" align="center" gap="half">
                                        <PaperFlex flex minWidth={0}>
                                            <PaperMediaCard
                                                title={c.title}
                                                subtitle={`${when(c.endedAt)} · ${c.messages === 1 ? "1 message" : `${c.messages} messages`}`}
                                                disabled={busy()}
                                                onClick={() => void reopen(c)}
                                            />
                                        </PaperFlex>
                                        <PaperButton icon size="small" variant="text" disabled={busy()} aria-label={`Delete “${c.title}”`} title="Delete" onClick={() => askDelete(c)}>
                                            <PaperIcon>delete</PaperIcon>
                                        </PaperButton>
                                    </PaperFlex>
                                )}
                            </For>
                        </PaperFlex>
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
                        <PaperButton variant="text" disabled={busy()} onClick={() => setDeleting(null)}>
                            Keep it
                        </PaperButton>
                        <PaperButton variant="danger" disabled={busy()} onClick={() => void remove()}>
                            Delete
                        </PaperButton>
                    </>
                }
            >
                <PaperFlex gap="full">
                    <PaperText>“{deleting()?.title}” is deleted for good. What the agent remembers from it stays in its memory.</PaperText>
                    <Show when={deleteError()}>
                        <PaperQuote variant="danger" icon="error" title="Conversation not deleted" role="alert">
                            {deleteError()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperModal>
        </>
    );
}
