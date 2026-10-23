// What the agent remembers, shared with the user: short facts it always has
// in mind, and notes (a key, when it's needed, a body) it reads when they
// apply. The user can add, change and forget either. The list follows the
// service's memory revision, so what the agent remembers shows up live.

import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup } from "solid-js";
import { PaperButton, PaperEmptyState, PaperIcon, PaperInput, PaperLoader, PaperSectionHeader, PaperText } from "@mileniumhq/paperui";
import { LIMITS, type MemoryList } from "../contract";
import type { Agent } from "../lib/agent";
import styles from "./Memories.module.css";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Memories(props: { agent: Agent }) {
    const { agent } = props;
    const name = () => agent.state.settings?.name ?? "Your agent";
    const [list, setList] = createSignal<MemoryList | null>(null);
    const [error, setError] = createSignal<string | null>(null);
    const [open, setOpen] = createSignal<string | "new" | null>(null);

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
            <Match when={open() !== null}>
                <NoteEditor agent={agent} noteKey={open() === "new" ? null : open()!} onDone={() => setOpen(null)} />
            </Match>
            <Match when={true}>
                <div class={styles.memories}>
                    <Show when={empty()}>
                        <PaperEmptyState icon="neurology" title="Nothing yet" description={`${name()} hasn't remembered anything. Add a fact, or it will as you talk.`} />
                    </Show>
                    <Facts agent={agent} facts={list()!.facts} />
                    <PaperSectionHeader icon="description" title="Notes" count={list()!.notes.length}>
                        <PaperButton size="small" onClick={() => setOpen("new")}>
                            New note
                        </PaperButton>
                    </PaperSectionHeader>
                    <For each={list()!.notes}>
                        {(n) => (
                            <button type="button" class={styles.note} onClick={() => setOpen(n.key)}>
                                <PaperText>{n.key}</PaperText>
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
    const [draft, setDraft] = createSignal("");
    const [error, setError] = createSignal<string | null>(null);
    // a refused change says why; the list stays as the service has it
    const attempt = async (run: () => Promise<unknown>) => {
        setError(null);
        try {
            await run();
        } catch (e) {
            setError(message(e));
            return false;
        }
        return true;
    };
    const add = async () => {
        if (!draft().trim()) return;
        if (await attempt(() => props.agent.addFact(draft()))) setDraft("");
    };

    return (
        <div class={styles.group}>
            <PaperSectionHeader icon="lightbulb" title="Facts" count={props.facts.length} />
            <For each={props.facts}>
                {(f) => (
                    <div class={styles.row}>
                        <PaperInput
                            compact
                            fullWidth
                            label="Fact"
                            maxLength={LIMITS.memory.factChars}
                            value={f.text}
                            onChange={(e) => {
                                const text = e.currentTarget.value;
                                if (text.trim() !== f.text) void attempt(() => props.agent.editFact(f.id, text));
                            }}
                        />
                        <PaperButton icon size="small" variant="danger" aria-label={`Forget: ${f.text}`} title="Forget" onClick={() => void attempt(() => props.agent.deleteFact(f.id))}>
                            <PaperIcon>delete</PaperIcon>
                        </PaperButton>
                    </div>
                )}
            </For>
            <form
                class={styles.row}
                onSubmit={(e) => {
                    e.preventDefault();
                    void add();
                }}
            >
                <PaperInput compact fullWidth label="Add a fact" maxLength={LIMITS.memory.factChars} value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
                <PaperButton type="submit" size="small" disabled={!draft().trim()}>
                    Add
                </PaperButton>
            </form>
            <Show when={error()}>
                <PaperText size={1} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
        </div>
    );
}

function NoteEditor(props: { agent: Agent; noteKey: string | null; onDone: () => void }) {
    const [key, setKey] = createSignal(props.noteKey ?? "");
    const [when, setWhen] = createSignal("");
    const [body, setBody] = createSignal("");
    const [loaded, setLoaded] = createSignal(props.noteKey === null);
    const [error, setError] = createSignal<string | null>(null);
    const [saving, setSaving] = createSignal(false);

    const load = async () => {
        if (props.noteKey === null) return;
        setError(null);
        try {
            const n = await props.agent.readNote(props.noteKey);
            setWhen(n.when);
            setBody(n.body);
            setLoaded(true);
        } catch (e) {
            setError(message(e));
        }
    };
    void load();

    const run = async (act: () => Promise<unknown>) => {
        setSaving(true);
        setError(null);
        try {
            await act();
            props.onDone();
        } catch (e) {
            setError(message(e));
        } finally {
            setSaving(false);
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
                when={loaded()}
                fallback={
                    <Show when={error()} fallback={<PaperLoader loaderStatus="indeterminate" label="Reading note" />}>
                        <PaperEmptyState icon="error" title="Note can't be read" description={error()!}>
                            <PaperButton onClick={() => void load()}>Try again</PaperButton>
                        </PaperEmptyState>
                    </Show>
                }
            >
                <PaperInput
                    fullWidth
                    label="Key"
                    disabled={props.noteKey !== null}
                    maxLength={LIMITS.memory.keyChars}
                    placeholder="lowercase letters, digits and dashes"
                    value={key()}
                    onInput={(e) => setKey(e.currentTarget.value)}
                />
                <PaperInput fullWidth label="When it's needed" maxLength={LIMITS.memory.whenChars} value={when()} onInput={(e) => setWhen(e.currentTarget.value)} />
                <PaperInput fullWidth multiline rows={14} label="Note" value={body()} onInput={(e) => setBody(e.currentTarget.value)} />
                <Show when={error()}>
                    <PaperText size={1} color="danger" role="alert">
                        {error()}
                    </PaperText>
                </Show>
                <div class={styles.row}>
                    <PaperButton disabled={saving()} onClick={() => void run(() => props.agent.saveNote(key(), when(), body()))}>
                        Save
                    </PaperButton>
                    <Show when={props.noteKey !== null}>
                        <PaperButton variant="danger" disabled={saving()} onClick={() => void run(() => props.agent.deleteNote(props.noteKey!))}>
                            Forget this note
                        </PaperButton>
                    </Show>
                </div>
            </Show>
        </div>
    );
}
