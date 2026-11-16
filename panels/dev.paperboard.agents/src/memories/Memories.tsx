// What the agent remembers, shared with the user: short facts it always has
// in mind, and notes (a key, when it's needed, a body) it reads when they
// apply. Only the agent writes them, with its memory tools; the user reads
// them and can make it forget any. The list follows the service's memory
// revision, so what the agent remembers shows up live.

import { For, Match, Show, Switch, createSignal } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperLoader,
    PaperMarkdown,
    PaperMediaCard,
    PaperSectionHeader,
    PaperText,
    createAction,
    createRead,
    showError,
} from "@mileniumhq/paperui";
import type { MemoryList } from "../contract";
import type { Agent } from "../lib/agent";
import { holdPage } from "../lib/pageHold";
import { toastFailure } from "../lib/toastFailure";

export default function Memories(props: { agent: Agent }) {
    const name = () => props.agent.name();
    // follows the memory revision; a re-read changes only what differs, and every card stays the card it was
    const memory = createRead(() => props.agent.calls.memory(), { source: () => props.agent.state.memory.revision });
    const list = () => memory.value() ?? null;
    const [open, setOpen] = createSignal<string | null>(null);
    // the page before this one stays up until the first read is in
    holdPage(memory.ready());

    const empty = () => list() !== null && list()!.facts.length === 0 && list()!.notes.length === 0;

    return (
        <Switch>
            <Match when={memory.error() ?? props.agent.state.memory.error}>
                {(why) => (
                    <PaperEmptyState icon="error" title="Memory can't be read" description={why()}>
                        <PaperButton onClick={() => void memory.reload()}>Try again</PaperButton>
                    </PaperEmptyState>
                )}
            </Match>
            <Match when={list() === null}>
                <PaperLoader loaderStatus="indeterminate" label="Reading memory" />
            </Match>
            <Match when={open()}>
                {(key) => <Note agent={props.agent} noteKey={key()} onDone={() => setOpen(null)} />}
            </Match>
            <Match when={true}>
                <PaperFlex gap="full">
                    <Show when={empty()}>
                        <PaperEmptyState icon="neurology" title="Nothing yet" description={`${name()} hasn't remembered anything. It will as you talk.`} />
                    </Show>
                    <Facts agent={props.agent} facts={list()!.facts} />
                    <PaperSectionHeader icon="description" title="Notes" count={list()!.notes.length} />
                    <For each={list()!.notes}>{(n) => <PaperMediaCard title={n.key} subtitle={n.when} onClick={() => setOpen(n.key)} />}</For>
                </PaperFlex>
            </Match>
        </Switch>
    );
}

function Facts(props: { agent: Agent; facts: MemoryList["facts"] }) {
    // a refused forget says why in a toast; the list stays as the service has it
    // a second press while the first is on its way is the same forget, not a refused one
    const forgetting = new Set<string>();
    const forget = (id: string) => {
        if (forgetting.has(id)) return;
        forgetting.add(id);
        props.agent.calls
            .deleteFact({ id })
            .catch((e) => showError("Couldn't forget the fact", e))
            .finally(() => forgetting.delete(id));
    };

    return (
        <PaperFlex gap="half">
            <PaperSectionHeader icon="lightbulb" title="Facts" count={props.facts.length} />
            <For each={props.facts}>
                {(f) => (
                    <PaperCard borderless paddingX="full" paddingY="half">
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperFlex flex minWidth={0}>
                                <PaperText preset="text" breakWord>
                                    {f.text}
                                </PaperText>
                            </PaperFlex>
                            <PaperButton icon size="small" variant="text" aria-label={`Forget: ${f.text}`} title="Forget" onClick={() => forget(f.id)}>
                                <PaperIcon>delete</PaperIcon>
                            </PaperButton>
                        </PaperFlex>
                    </PaperCard>
                )}
            </For>
        </PaperFlex>
    );
}

function Note(props: { agent: Agent; noteKey: string; onDone: () => void }) {
    const note = createRead(() => props.agent.calls.readNote({ key: props.noteKey }));
    const { busy: forgetting, run } = createAction();

    const forget = async () => {
        if (await run("Couldn't forget the note", () => props.agent.calls.deleteNote({ key: props.noteKey }), toastFailure)) props.onDone();
    };

    return (
        <PaperFlex gap="full">
            <PaperFlex direction="row">
                <PaperButton size="small" variant="text" onClick={props.onDone}>
                    <PaperIcon>arrow_back</PaperIcon>
                    Back
                </PaperButton>
            </PaperFlex>
            <Show
                when={note.value()}
                fallback={
                    <Show when={note.error()} fallback={<PaperLoader loaderStatus="indeterminate" label="Reading note" />}>
                        <PaperEmptyState icon="error" title="Note can't be read" description={note.error()!}>
                            <PaperButton onClick={() => void note.reload()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </Show>
                }
            >
                {(n) => (
                    <>
                        <PaperSectionHeader icon="description" title={props.noteKey} />
                        <PaperText preset="hint" inset>
                            Read {n().when}
                        </PaperText>
                        <PaperMarkdown text={n().body} />
                        <PaperFlex direction="row">
                            <PaperButton variant="danger" disabled={forgetting()} onClick={() => void forget()}>
                                Forget this note
                            </PaperButton>
                        </PaperFlex>
                    </>
                )}
            </Show>
        </PaperFlex>
    );
}
