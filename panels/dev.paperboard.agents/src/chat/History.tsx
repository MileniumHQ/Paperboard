// The conversations: the current one, marked, and the past ones. Open one to
// continue it (the current one takes its place in the list), or delete one
// for good after saying so.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperModal, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { CURRENT_CONVERSATION as CURRENT, type PastConversation } from "../contract";
import type { Agent } from "../lib/agent";
import { errorText, failure, type Failure } from "../lib/failure";
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function History(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const [list, setList] = createSignal<{ current: PastConversation | null; past: PastConversation[] } | null>(null);
    const [readError, setReadError] = createSignal<string | null>(null);
    const [openError, setOpenError] = createSignal<Failure | null>(null);
    const [deleteError, setDeleteError] = createSignal<string | null>(null);
    const [busy, setBusy] = createSignal(false);
    const [deleting, setDeleting] = createSignal<PastConversation | null>(null);
    // the current one is marked; one being opened is, until it's open or wasn't
    const [chosen, setChosen] = createSignal(CURRENT);
    const all = () => (list() ? [...(list()!.current ? [list()!.current!] : []), ...list()!.past] : []);

    const load = async () => {
        setReadError(null);
        setOpenError(null);
        setList(null);
        setChosen(CURRENT);
        try {
            setList(await props.agent.conversations());
        } catch (e) {
            setReadError(errorText(e));
        }
    };

    // read afresh each time it opens: the agent may have started or reopened one meanwhile
    createEffect(on(() => props.open, (open) => open && void load()));

    const reopen = async (c: PastConversation) => {
        setChosen(c.id);
        setBusy(true);
        setOpenError(null);
        try {
            await props.agent.openConversation(c.id);
            props.onClose();
        } catch (e) {
            setOpenError(failure("Conversation not opened", e));
        } finally {
            setChosen(CURRENT);
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
            setList((l) => l && { ...l, past: l.past.filter((x) => x.id !== c.id) });
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
                title="Conversations"
                size="medium"
                noPadding
            >
                <Switch>
                    <Match when={list() === null && readError()}>
                        <PaperFlex padding="double">
                            <PaperEmptyState icon="error" title="The history can't be read" description={readError()!}>
                                <PaperButton onClick={() => void load()}>Try again</PaperButton>
                            </PaperEmptyState>
                        </PaperFlex>
                    </Match>
                    <Match when={list() === null}>
                        <PaperFlex padding="double">
                            <PaperLoader loaderStatus="indeterminate" label="Reading the history" />
                        </PaperFlex>
                    </Match>
                    <Match when={all().length === 0}>
                        <PaperFlex padding="double">
                            <PaperEmptyState icon="history" title="No conversations yet" description="Say hi, and your conversation shows up here." />
                        </PaperFlex>
                    </Match>
                    <Match when={true}>
                        <Show when={openError()}>
                            {(shown) => (
                                <PaperFlex padding="full">
                                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                                        {shown().message}
                                    </PaperQuote>
                                </PaperFlex>
                            )}
                        </Show>
                        <PaperList
                            name="agents-history"
                            value={chosen()}
                            onValueChange={(v) => v !== CURRENT && void reopen(list()!.past.find((c) => c.id === v)!)}
                            borderless
                            fullWidth
                            fullHeight
                        >
                            <For each={all()}>
                                {(c) => (
                                    <PaperListItem
                                        value={c.id}
                                        disabled={busy()}
                                        // the marked one is chosen already: choosing it goes back to it
                                        onClick={() => c.id === CURRENT && props.onClose()}
                                        description={`${c.id === CURRENT ? "Now" : when(c.endedAt)} · ${c.messages === 1 ? "1 message" : `${c.messages} messages`}`}
                                        actions={
                                            <Show when={c.id !== CURRENT}>
                                                <PaperButton
                                                    icon
                                                    size="small"
                                                    variant="text"
                                                    disabled={busy()}
                                                    aria-label={`Delete “${c.title}”`}
                                                    title="Delete"
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={() => askDelete(c)}
                                                >
                                                    <PaperIcon>delete</PaperIcon>
                                                </PaperButton>
                                            </Show>
                                        }
                                    >
                                        {c.title}
                                    </PaperListItem>
                                )}
                            </For>
                        </PaperList>
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
                    <PaperText preset="text">“{deleting()?.title}” is deleted for good. What the agent remembers from it stays in its memory.</PaperText>
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
