// The conversations: the current one, marked, and the past ones. Open one to
// continue it (the current one takes its place in the list), or delete one
// for good after saying so.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import { PaperButton, PaperEmptyState, PaperError, PaperFlex, PaperIcon, PaperList, PaperListItem, PaperLoader, PaperModal, PaperText, createAction, createRead } from "@mileniumhq/paperui";
import { CURRENT_CONVERSATION as CURRENT, type PastConversation } from "../contract";
import type { Agent } from "../lib/agent";
const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export default function History(props: { agent: Agent; open: boolean; onClose: () => void }) {
    // read afresh each time it opens: the agent may have started or reopened one meanwhile
    const history = createRead(() => props.agent.calls.conversations(), { source: () => props.open });
    const list = history.value;
    // a refusal is a toast over the dialog, which stays open
    const { busy, run } = createAction();
    const [deleting, setDeleting] = createSignal<PastConversation | null>(null);
    // the current one is marked; one being opened is, until it's open or wasn't
    const [chosen, setChosen] = createSignal(CURRENT);
    const all = () => (list() ? [...(list()!.current ? [list()!.current!] : []), ...list()!.past] : []);
    // each opening starts on the current one
    createEffect(on(() => props.open, (open) => open && setChosen(CURRENT)));

    const reopen = async (c: PastConversation) => {
        setChosen(c.id);
        if (await run("Couldn't open the conversation", () => props.agent.calls.openConversation({ id: c.id }))) props.onClose();
        setChosen(CURRENT);
    };

    const remove = () => {
        const c = deleting()!;
        return run(
            "Couldn't delete the conversation",
            async () => {
                await props.agent.calls.deleteConversation({ id: c.id });
                setDeleting(null);
                history.set((l) => l && { ...l, past: l.past.filter((x) => x.id !== c.id) });
            },
        );
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
                    <Match when={history.loading() || (!list() && !history.error())}>
                        <PaperFlex padding="double">
                            <PaperLoader loaderStatus="indeterminate" label="Reading the history" />
                        </PaperFlex>
                    </Match>
                    <Match when={!list() && history.error()}>
                        {(err) => <PaperError fill title="Couldn't load the conversations" error={err()} action={{ label: "Try again", onClick: () => void history.reload() }} />}
                    </Match>
                    <Match when={all().length === 0}>
                        <PaperFlex padding="double">
                            <PaperEmptyState icon="history" title="No conversations yet" description="Say hi, and your conversation shows up here." />
                        </PaperFlex>
                    </Match>
                    <Match when={true}>
                        {/* a read again that failed: the list it had stays, under why */}
                        <Show when={history.error()}>
                            {(err) => (
                                <PaperFlex padding="full">
                                    <PaperError title="Couldn't load the conversations" error={err()} action={{ label: "Try again", onClick: () => void history.reload() }} />
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
                                                    onClick={() => setDeleting(c)}
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
                </PaperFlex>
            </PaperModal>
        </>
    );
}
