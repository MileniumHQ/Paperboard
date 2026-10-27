// The agent's settings: who it is, its brain, its computer and the
// conversation. Each change saves as it's made, through the service, which
// validates it; a refused change says why and shows what's still saved.

import { For, Match, Show, Switch, createEffect, createResource, createSignal, on } from "solid-js";
import {
    PaperButton,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@mileniumhq/paperui";
import BrainLogo from "../lib/BrainLogo";
import { COMPACTIONS, HARNESSES, LIMITS, type Compaction, type Harness, type Settings as Saved } from "../contract";
import type { Agent } from "../lib/agent";
import { SEARCH_MODELS_FROM, createModels, harnessName, loadedModels } from "../lib/brains";
import styles from "./Settings.module.css";

const DEFAULT_MODEL = "default";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Settings(props: { agent: Agent }) {
    const { agent } = props;
    return (
        <div class={styles.settings}>
            <AgentSettings agent={agent} />
            <PaperSeparator />
            <ComputerSettings agent={agent} />
            <PaperSeparator />
            <ConversationSettings agent={agent} />
        </div>
    );
}

function AgentSettings(props: { agent: Agent }) {
    const current = () => props.agent.state.settings!;
    // the name is typed, so it saves when the field is left; the rest save when picked
    const [name, setName] = createSignal(current().name);
    const [model, setModel] = createSignal(current().model ?? "");
    const [error, setError] = createSignal<string | null>(null);
    const [installed] = createResource(() => props.agent.detect());
    const models = createModels(props.agent, () => current().harness);
    // as the harness lists them: its current models, then its older ones
    const listed = () => loadedModels(models) ?? [];
    const unlisted = () => {
        const id = current().model;
        const all = loadedModels(models);
        return id && all && !all.some((m) => m.id === id) ? id : null;
    };
    // a change made elsewhere (the composer's brain menu) shows here
    createEffect(on(() => current().name, (n) => setName(n)));
    createEffect(on(() => current().model, (m) => setModel(m ?? "")));

    // one save at a time, each of the whole settings as they stand
    let queue: Promise<void> = Promise.resolve();
    const save = (patch: Partial<Saved>) => {
        queue = queue.then(async () => {
            const next = { ...current(), ...patch };
            if (next.name === current().name && next.harness === current().harness && next.model === current().model) return;
            setError(null);
            try {
                await props.agent.setup(next);
            } catch (e) {
                setError(message(e));
                // what's saved is what shows
                setName(current().name);
                setModel(current().model ?? "");
            }
        });
    };
    const saveName = () => {
        const n = name().trim();
        if (!n) {
            setError("It needs a name.");
            setName(current().name);
            return;
        }
        save({ name: n });
    };
    const isInstalled = (h: Harness) => installed()?.find((i) => i.id === h)?.installed ?? h === current().harness;

    return (
        <section class={styles.group} aria-label="Agent">
            <PaperText as="h2" preset="subtitle" class={styles.title}>
                Agent
            </PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Name" description="What it's called, and what it calls itself.">
                    <PaperInput
                        name="name"
                        label="Name"
                        value={name()}
                        maxLength={LIMITS.name}
                        onInput={(e) => setName(e.currentTarget.value)}
                        onChange={saveName}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                </PaperSettingItem>
                <PaperSettingItem title="Brain" description="The agent harness that thinks for it. Each keeps its own thread of your conversation.">
                    <PaperSelectMenu
                        name="harness"
                        aria-label="Brain"
                        value={current().harness}
                        // a model belongs to its harness: the new brain starts on its own default
                        onValueChange={(v) => v !== current().harness && save({ harness: v as Harness, model: null })}
                    >
                        <For each={HARNESSES}>
                            {(h) => (
                                <PaperSelectMenuItem value={h} icon={<BrainLogo harness={h} />} disabled={!isInstalled(h)}>
                                    {harnessName(h)}
                                    {isInstalled(h) ? "" : " (not installed)"}
                                </PaperSelectMenuItem>
                            )}
                        </For>
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem title="Model" description="Leave it on the default to use whatever the harness is set to already.">
                    <Show
                        when={!models.error}
                        fallback={
                            <div class={styles.field}>
                                <PaperInput
                                    name="model"
                                    label="Model"
                                    placeholder="Default"
                                    value={model()}
                                    maxLength={LIMITS.model}
                                    onInput={(e) => setModel(e.currentTarget.value)}
                                    onChange={() => save({ model: model().trim() || null })}
                                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                                />
                                <PaperText size={1} color="muted">
                                    {message(models.error)} Type a model's id instead.
                                </PaperText>
                            </div>
                        }
                    >
                        <PaperSelectMenu
                            name="model"
                            aria-label="Model"
                            value={current().model ?? DEFAULT_MODEL}
                            disabled={!loadedModels(models)}
                            searchable={listed().length >= SEARCH_MODELS_FROM}
                            onValueChange={(v) => save({ model: v === DEFAULT_MODEL ? null : String(v) })}
                        >
                            <PaperSelectMenuItem value={DEFAULT_MODEL} icon="tune" description={`Whatever ${harnessName(current().harness)} is set to use`}>
                                Default
                            </PaperSelectMenuItem>
                            <For each={listed()}>
                                {(m) => (
                                    <PaperSelectMenuItem value={m.id} description={m.older ? "Older" : (m.description ?? undefined)}>
                                        {m.name}
                                    </PaperSelectMenuItem>
                                )}
                            </For>
                            {/* a model saved by id that the harness no longer lists stays chosen, as typed */}
                            <Show when={unlisted()}>
                                {(id) => <PaperSelectMenuItem value={id()}>{id()}</PaperSelectMenuItem>}
                            </Show>
                        </PaperSelectMenu>
                    </Show>
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
        </section>
    );
}

function ComputerSettings(props: { agent: Agent }) {
    const c = () => props.agent.state.computer;
    const name = () => props.agent.state.settings!.name;
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [confirming, setConfirming] = createSignal(false);

    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
            return true;
        } catch (e) {
            setError(message(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const status = () =>
        ({
            none: "Not set up",
            unsupported: "Can't run here",
            installing: "Setting up…",
            starting: "Starting…",
            ready: "On",
            stopping: "Stopping…",
            stopped: "Off",
            failed: "Stopped with a problem",
        })[c().phase];

    return (
        <section class={styles.group} aria-label="Computer">
            <PaperText as="h2" preset="subtitle" class={styles.title}>
                Computer
            </PaperText>
            <Switch>
                <Match when={c().phase === "unsupported"}>
                    <PaperText size={2} color="text-muted">
                        {c().error}
                    </PaperText>
                </Match>
                <Match when={!c().installed && c().phase !== "installing"}>
                    <PaperSettingList autoHeight>
                        <PaperSettingItem title={`${name()}'s own computer`} description="A web browser of its own it uses for its work, about 400 MB of storage. It reaches the internet, never your files or your network.">
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act(props.agent.installComputer)}>
                                <PaperIcon>computer</PaperIcon> Set up
                            </PaperButton>
                        </PaperSettingItem>
                    </PaperSettingList>
                </Match>
                <Match when={true}>
                    <PaperSettingList autoHeight>
                        <PaperSettingItem title="Status" description={c().phase === "failed" ? (c().error ?? undefined) : `${status()}.`}>
                            <Switch>
                                <Match when={c().phase === "ready"}>
                                    <PaperButton disabled={busy()} onClick={() => void act(props.agent.stopComputer)}>
                                        <PaperIcon>power_settings_new</PaperIcon> Turn off
                                    </PaperButton>
                                </Match>
                                <Match when={c().phase === "stopped" || c().phase === "failed"}>
                                    <PaperButton disabled={busy()} onClick={() => void act(props.agent.startComputer)}>
                                        <PaperIcon>power_settings_new</PaperIcon> {c().phase === "failed" ? "Try again" : "Turn on"}
                                    </PaperButton>
                                </Match>
                            </Switch>
                        </PaperSettingItem>
                        <PaperSettingItem title="Set up again" description={`Erases ${name()}'s computer, with everything on it, and builds a fresh one.`}>
                            <PaperButton
                                variant="danger"
                                disabled={busy() || c().phase === "installing"}
                                onClick={() => setConfirming(true)}
                            >
                                <PaperIcon>restart_alt</PaperIcon> Set up again
                            </PaperButton>
                        </PaperSettingItem>
                    </PaperSettingList>
                </Match>
            </Switch>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>

            <PaperModal
                open={confirming()}
                onClose={() => !busy() && setConfirming(false)}
                title={`Erase ${name()}'s computer?`}
                size="small"
                footer={
                    <>
                        <PaperButton disabled={busy()} onClick={() => setConfirming(false)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={async () => {
                                if (await act(() => props.agent.installComputer())) setConfirming(false);
                            }}
                        >
                            Erase and set up
                        </PaperButton>
                    </>
                }
            >
                <PaperText>Everything on it is deleted: its files, downloads and sign-ins. This can't be undone.</PaperText>
            </PaperModal>
        </section>
    );
}

const COMPACTION_TEXT: Record<Compaction, { title: string; icon: string; description: string }> = {
    summarize: { title: "Summarize", icon: "summarize", description: "It writes itself a summary, and keeps the latest messages" },
    forget: { title: "Forget", icon: "history_toggle_off", description: "It keeps only the latest messages" },
};

function ConversationSettings(props: { agent: Agent }) {
    const [open, setOpen] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const current = () => props.agent.state.settings!;
    const setCompaction = (compaction: Compaction) => {
        if (compaction === current().compaction) return;
        setError(null);
        props.agent.setup({ ...current(), compaction }).catch((e) => setError(message(e)));
    };
    return (
        <section class={styles.group} aria-label="Conversation">
            <PaperText as="h2" preset="subtitle" class={styles.title}>
                Conversation
            </PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Compaction" description="A long conversation costs more tokens with every reply. Past a point, it's compacted: this is what happens to its older part.">
                    <PaperSelectMenu name="compaction" aria-label="Compaction" value={current().compaction} onValueChange={(v) => setCompaction(v as Compaction)}>
                        <For each={COMPACTIONS}>
                            {(c) => (
                                <PaperSelectMenuItem value={c} icon={COMPACTION_TEXT[c].icon} description={COMPACTION_TEXT[c].description}>
                                    {COMPACTION_TEXT[c].title}
                                </PaperSelectMenuItem>
                            )}
                        </For>
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem title="Start over" description={`${props.agent.state.settings!.name} forgets the conversation and starts fresh.`}>
                    <PaperButton variant="danger" onClick={() => setOpen(true)}>
                        <PaperIcon>delete_sweep</PaperIcon> Start over
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
            <StartOver agent={props.agent} open={open()} onClose={() => setOpen(false)} />
        </section>
    );
}

/** The confirmation for starting over, from settings or the composer's menu. */
export function StartOver(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const name = () => props.agent.state.settings?.name ?? "Your agent";
    return (
        <PaperModal
            open={props.open}
            onClose={() => !busy() && props.onClose()}
            title="Start over?"
            size="small"
            footer={
                <>
                    <PaperButton disabled={busy()} onClick={props.onClose}>
                        Keep talking
                    </PaperButton>
                    <PaperButton
                        variant="danger"
                        disabled={busy()}
                        onClick={async () => {
                            setBusy(true);
                            setError(null);
                            try {
                                await props.agent.startOver();
                                props.onClose();
                            } catch (e) {
                                setError(message(e));
                            } finally {
                                setBusy(false);
                            }
                        }}
                    >
                        Start over
                    </PaperButton>
                </>
            }
        >
            <PaperText>
                {name()} stops what it's doing and forgets your whole conversation. Its computer and what's on it stay. This can't be undone.
            </PaperText>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">
                    {error()}
                </PaperText>
            </Show>
        </PaperModal>
    );
}
