// What the agent remembers, shared with the user: short facts it always has
// in mind, and notes (a key, when it's needed, a body) it reads when they
// apply. Only the agent writes them, with its memory tools; the user reads
// them and can make it forget any. The list follows the service's memory
// revision, so what the agent remembers shows up live.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperLoader, PaperMarkdown, PaperSectionHeader, PaperText } from "@mileniumhq/paperui";
import type { MemoryList } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./Memories.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Memories(props: { agent: Agent }) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";
    const [list, setList] = createSignal<MemoryList | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [open, setOpen] = createSignal<string | null>(null);

    let gone = false;
    onCleanup(() => (gone = true));
    // latest read wins: an older answer never replaces a newer one
    let reads = 0;
    const load = async () => {
        const mine = ++reads;
        try {
            const next = await agent.memory();
            if (!gone && mine === reads) {
                setList(next);
                setError(null);
            }
        } catch (e) {
            if (!gone && mine === reads) setError(message(e));
        }
    };
    createEffect(on(() => agent.state.memory.revision, () => void load()));

    const empty = () => list() !== null && list()!.facts.length === 0 && list()!.notes.length === 0;

    return (
        <Switch>
            <Match when={error() ?? agent.state.memory.error}>
                {(why) => (
                    <PaperEmptyState icon="error" title="Memory can't be read" description={why()}>
                        <PaperButton onClick={() => void load()}>Try again</PaperButton>
                    </PaperEmptyState>
                )}
            </Match>
            <Match when={list() === null}>
                <PaperLoader loaderStatus="indeterminate" label="Reading memory" />
            </Match>
            <Match when={open()}>
                {(key) => <Note agent={agent} noteKey={key()} onDone={() => setOpen(null)} />}
            </Match>
            <Match when={true}>
                <div class={styles.memories}>
                    <Show when={empty()}>
                        <PaperEmptyState icon="neurology" title="Nothing yet" description={`${name()} hasn't remembered anything. It will as you talk.`} />
                    </Show>
                    <Facts agent={agent} facts={list()!.facts} />
                    <PaperSectionHeader icon="description" title="Notes" count={list()!.notes.length} />
                    <For each={list()!.notes}>
                        {(n) => (
                            <button type="button" class={styles.note} onClick={() => setOpen(n.key)}>
                                <PaperText size={2}>{n.key}</PaperText>
                                <PaperText size={1} color="muted">
                                    {n.when}
                                </PaperText>
                            </button>
                        )}
                    </For>
                </div>
            </Match>
        </Switch>
    );
}

function Facts(props: { agent: Agent; facts: MemoryList["facts"] }) {
    const [error, setError] = createSignal<string | null>(null);
    // a refused forget says why; the list stays as the service has it
    const forget = (id: string) => {
        setError(null);
        props.agent.deleteFact(id).catch((e) => setError(message(e)));
    };

    return (
        <div class={styles.group}>
            <PaperSectionHeader icon="lightbulb" title="Facts" count={props.facts.length} />
            <For each={props.facts}>
                {(f) => (
                    <div class={styles.factRow}>
                        <PaperText size={2} class={styles.fact}>{f.text}</PaperText>
                        <PaperButton icon size="small" variant="danger" aria-label={`Forget: ${f.text}`} title="Forget" onClick={() => forget(f.id)}>
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
    );
}

function Note(props: { agent: Agent; noteKey: string; onDone: () => void }) {
    const [note, setNote] = createSignal<{ when: string; body: string } | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [forgetting, setForgetting] = createSignal(false);

    const load = async () => {
        setError(null);
        try {
            setNote(await props.agent.readNote(props.noteKey));
        } catch (e) {
            setError(message(e));
        }
    };
    void load();

    const forget = async () => {
        setForgetting(true);
        setError(null);
        try {
            await props.agent.deleteNote(props.noteKey);
            props.onDone();
        } catch (e) {
            setError(message(e));
        } finally {
            setForgetting(false);
        }
    };

    return (
        <div class={styles.memories}>
            <div class={styles.row}>
                <PaperButton size="small" variant="text" onClick={props.onDone}>
                    <PaperIcon>arrow_back</PaperIcon>
                    Back
                </PaperButton>
            </div>
            <Show
                when={note()}
                fallback={
                    <Show when={error()} fallback={<PaperLoader loaderStatus="indeterminate" label="Reading note" />}>
                        <PaperEmptyState icon="error" title="Note can't be read" description={error()!}>
                            <PaperButton onClick={() => void load()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </Show>
                }
            >
                {(n) => (
                    <>
                        <PaperSectionHeader icon="description" title={props.noteKey} />
                        <PaperText size={1} color="muted">
                            Read {n().when}
                        </PaperText>
                        <PaperMarkdown text={n().body} />
                        <Show when={error()}>
                            <PaperText size={1} color="danger" role="alert">
                                {error()}
                            </PaperText>
                        </Show>
                        <div class={styles.row}>
                            <PaperButton variant="danger" disabled={forgetting()} onClick={() => void forget()}>
                                Forget this note
                            </PaperButton>
                        </div>
                    </>
                )}
            </Show>
        </div>
    );
}
