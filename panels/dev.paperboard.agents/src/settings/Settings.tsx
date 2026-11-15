// The agent's settings: who it is, its brain, its computer and the
// conversation. Each change saves as it's made, through the service, which
// validates it; a refused change says why and shows what's still saved.

import { For, Match, Show, Switch, createEffect, createSignal, on } from "solid-js";
import {
    PaperButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperQuote,
    PaperSelectMenu,
    PaperSectionHeader,
    PaperSelectMenuItem,
    PaperSeparator,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
    type ActionFailure,
    createAction,
    createSavedValue,
} from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import BrainLogo from "../lib/BrainLogo";
import { COMPACTIONS, DEFAULT_MODEL, HARNESSES, LIMITS, type Compaction, type Harness, type Settings as Saved } from "../contract";
import type { Agent } from "../lib/agent";
import { SEARCH_MODELS_FROM, createModels, harnessName, loadedModels } from "../lib/brains";
import { BrainButtons, BrainStatus, SignInModal, brainLine, createBrainActions } from "./Brain";
import Providers from "./Providers";

export default function Settings(props: { agent: Agent }) {
    return (
        <PaperFlex gap="full">
            <AgentSettings agent={props.agent} />
            <PaperSeparator />
            <BrainsSettings agent={props.agent} />
            <PaperSeparator />
            <ComputerSettings agent={props.agent} />
            <PaperSeparator />
            <ConversationSettings agent={props.agent} />
            <PaperSeparator />
            <AutomationSettings agent={props.agent} />
        </PaperFlex>
    );
}

function AgentSettings(props: { agent: Agent }) {
    const current = () => props.agent.state.settings!;
    // the name is typed, so it saves when the field is left; the rest save when picked
    const [name, setName] = createSignal(current().name);
    const [model, setModel] = createSignal(current().model ?? "");
    const [error, setError] = createSignal<ActionFailure | null>(null);
    const models = createModels(props.agent, () => current().harness);
    // as the harness lists them: its current models, then its older ones
    const listed = () => loadedModels(models) ?? [];
    const unlisted = () => {
        const id = current().model;
        const all = loadedModels(models);
        return id && all && !all.some((m) => m.id === id) ? id : null;
    };
    // a change made elsewhere (in another window) shows here
    createEffect(on(() => current().name, (n) => setName(n)));
    createEffect(on(() => current().model, (m) => setModel(m ?? "")));
    // saved through the agent's one queue, each built from the settings as they stand when its turn comes
    const save = (patch: Partial<Saved>) =>
        props.agent.saveSettings((cur) => {
            const next = { ...cur, ...patch };
            return next.name === cur.name && next.harness === cur.harness && next.model === cur.model ? null : next;
        });
    // a pick shows at once, while it saves
    const harness = createSavedValue(() => current().harness, (h: Harness) => save({ harness: h, model: null }));
    const picked = createSavedValue(() => current().model ?? DEFAULT_MODEL, (v: string) => save({ model: v === DEFAULT_MODEL ? null : v }));
    const report = (title: string, saving: Promise<void>) => {
        setError(null);
        saving.catch((e) => {
            setError({ title, message: errorMessage(e) });
            // a name stays as typed, to be saved again; a choice goes back to what's saved
            setModel(current().model ?? "");
        });
    };
    const saveName = () => {
        const n = name().trim();
        if (!n) {
            setError({ title: "Name not saved", message: "It needs a name." });
            setName(current().name);
            return;
        }
        report("Name not saved", save({ name: n }));
    };
    // only a brain that is installed and signed in can think; the saved one stays choosable
    const isReady = (h: Harness) => props.agent.state.brains[h].phase === "ready" || h === current().harness;

    return (
        <PaperFlex gap="full" role="region" aria-label="Agent">
            <PaperSectionHeader icon="badge" title="Agent" role="heading" aria-level={2} />
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
                        value={harness.value()}
                        // a model belongs to its harness: the new brain starts on its own default
                        onValueChange={(v) => v !== current().harness && report("Brain not changed", harness.set(v as Harness))}
                    >
                        <For each={HARNESSES}>
                            {(h) => (
                                <PaperSelectMenuItem value={h} icon={<BrainLogo harness={h} />} disabled={!isReady(h)}>
                                    {harnessName(h)}
                                    {isReady(h) ? "" : " (not set up)"}
                                </PaperSelectMenuItem>
                            )}
                        </For>
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem title="Model" description="Leave it on the default to use whatever the harness is set to already.">
                    <Show
                        when={!models.error()}
                        fallback={
                            <PaperInput
                                name="model"
                                label="Model"
                                placeholder="Default"
                                value={model()}
                                maxLength={LIMITS.model}
                                onInput={(e) => setModel(e.currentTarget.value)}
                                onChange={() => report("Model not changed", save({ model: model().trim() || null }))}
                                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            />
                        }
                    >
                        <PaperSelectMenu
                            name="model"
                            aria-label="Model"
                            value={picked.value()}
                            disabled={!loadedModels(models)}
                            searchable={listed().length >= SEARCH_MODELS_FROM}
                            onValueChange={(v) => report("Model not changed", picked.set(String(v)))}
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
            <Show when={models.error()}>
                <PaperQuote variant="danger" icon="error" title="Models not listed" role="alert">
                    {models.error()!.replace(/[.\s]+$/, "")}. Type a model's id instead.
                </PaperQuote>
            </Show>
            <Show when={error()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>
        </PaperFlex>
    );
}

/** Codex, Claude and OpenCode: each is installed here from its maker and signed in with its own login. */
function BrainsSettings(props: { agent: Agent }) {
    const actions = createBrainActions(props.agent);
    const [providers, setProviders] = createSignal(false);
    // a sign-in happens in its modal; the list shows only the brains' other work and trouble
    const [signingIn, setSigningIn] = createSignal<Harness | null>(null);
    const busy = (h: Harness) => ["installing", "failed", "unsupported"].includes(props.agent.state.brains[h].phase) && h !== signingIn();
    return (
        <PaperFlex gap="full" role="region" aria-label="Brains">
            <PaperSectionHeader icon="psychology" title="Brains" role="heading" aria-level={2} />
            <PaperSettingList autoHeight>
                <For each={HARNESSES}>
                    {(h) => (
                        <PaperSettingItem title={harnessName(h)} description={brainLine(h, props.agent.state.brains[h])}>
                            <BrainButtons agent={props.agent} harness={h} actions={actions} onProviders={() => setProviders(true)} onSignIn={setSigningIn} />
                        </PaperSettingItem>
                    )}
                </For>
            </PaperSettingList>
            <For each={HARNESSES.filter(busy)}>
                {(h) => (
                    <PaperFlex gap="half">
                        <PaperText preset="section">{harnessName(h)}</PaperText>
                        <BrainStatus agent={props.agent} harness={h} actions={actions} />
                    </PaperFlex>
                )}
            </For>
            {/* a refusal for a brain with nothing else to show, and not in its sign-in, is told under the list */}
            <For each={HARNESSES.filter((h) => !busy(h) && h !== signingIn() && actions.error(h))}>
                {(h) => (
                    <PaperQuote variant="danger" icon="error" title={actions.error(h)!.title} role="alert">
                        {actions.error(h)!.message}
                    </PaperQuote>
                )}
            </For>
            <Providers agent={props.agent} open={providers()} onClose={() => setProviders(false)} />
            <SignInModal agent={props.agent} harness={signingIn()} actions={actions} onClose={() => setSigningIn(null)} />
        </PaperFlex>
    );
}

function ComputerSettings(props: { agent: Agent }) {
    const c = () => props.agent.state.computer;
    const name = () => props.agent.state.settings!.name;
    const { busy, error, run: act } = createAction();
    const [confirming, setConfirming] = createSignal(false);
    // a refused erase is told in the confirmation, which stays open over the page
    const [eraseError, setEraseError] = createSignal<ActionFailure | null>(null);
    const erase = () =>
        act(
            "Computer not erased",
            async () => {
                await props.agent.calls.installComputer();
                setConfirming(false);
            },
            setEraseError,
        );
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
        <PaperFlex gap="full" role="region" aria-label="Computer">
            <PaperSectionHeader icon="computer" title="Computer" role="heading" aria-level={2} />
            <Switch>
                <Match when={c().phase === "unsupported"}>
                    <PaperText preset="hint" inset>
                        {c().error}
                    </PaperText>
                </Match>
                <Match when={!c().installed && c().phase !== "installing"}>
                    <PaperSettingList autoHeight>
                        <PaperSettingItem title={`${name()}'s own computer`} description="A web browser of its own it uses for its work, about 400 MB of storage. It reaches the internet, never your files or your network.">
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act("Computer not set up", props.agent.calls.installComputer)}>
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
                                    <PaperButton disabled={busy()} onClick={() => void act("Computer not turned off", props.agent.calls.stopComputer)}>
                                        <PaperIcon>power_settings_new</PaperIcon> Turn off
                                    </PaperButton>
                                </Match>
                                <Match when={c().phase === "stopped" || c().phase === "failed"}>
                                    <PaperButton disabled={busy()} onClick={() => void act("Computer not turned on", props.agent.calls.startComputer)}>
                                        <PaperIcon>power_settings_new</PaperIcon> {c().phase === "failed" ? "Try again" : "Turn on"}
                                    </PaperButton>
                                </Match>
                            </Switch>
                        </PaperSettingItem>
                        <PaperSettingItem title="Set up again" description={`Erases ${name()}'s computer, with everything on it, and builds a fresh one.`}>
                            <PaperButton
                                variant="danger"
                                disabled={busy() || c().phase === "installing"}
                                onClick={() => {
                                    setEraseError(null);
                                    setConfirming(true);
                                }}
                            >
                                <PaperIcon>restart_alt</PaperIcon> Set up again
                            </PaperButton>
                        </PaperSettingItem>
                    </PaperSettingList>
                </Match>
            </Switch>
            <Show when={error()}>
                {(shown) => (
                    <PaperQuote variant="danger" icon="error" title={shown().title} role="alert">
                        {shown().message}
                    </PaperQuote>
                )}
            </Show>

            <PaperModal
                open={confirming()}
                onClose={() => !busy() && setConfirming(false)}
                title={`Erase ${name()}'s computer?`}
                size="small"
                footer={
                    <>
                        <PaperButton variant="text" disabled={busy()} onClick={() => setConfirming(false)}>
                            Keep it
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={busy()}
                            onClick={() => void erase()}
                        >
                            Erase and set up
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="text">Everything on it is deleted: its files, downloads and sign-ins. This can't be undone.</PaperText>
                <Show when={eraseError()}>
                    {(why) => (
                        <PaperQuote variant="danger" icon="error" title={why().title} role="alert">
                            {why().message}
                        </PaperQuote>
                    )}
                </Show>
            </PaperModal>
        </PaperFlex>
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
    const compaction = createSavedValue(
        () => current().compaction,
        (next: Compaction) => props.agent.saveSettings((cur) => (cur.compaction === next ? null : { ...cur, compaction: next })),
    );
    const setCompaction = (next: Compaction) => {
        setError(null);
        compaction.set(next).catch((e) => setError(errorMessage(e)));
    };
    return (
        <PaperFlex gap="full" role="region" aria-label="Conversation">
            <PaperSectionHeader icon="forum" title="Conversation" role="heading" aria-level={2} />
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Compaction" description="A long conversation costs more tokens with every reply. Past a point, it's compacted: this is what happens to its older part.">
                    <PaperSelectMenu name="compaction" aria-label="Compaction" value={compaction.value()} onValueChange={(v) => setCompaction(v as Compaction)}>
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
                <PaperQuote variant="danger" icon="error" title="Compaction not changed" role="alert">
                    {error()}
                </PaperQuote>
            </Show>
            <StartOver agent={props.agent} open={open()} onClose={() => setOpen(false)} />
        </PaperFlex>
    );
}

function AutomationSettings(props: { agent: Agent }) {
    const current = () => props.agent.state.settings!;
    // typed, so it saves when the field is left
    const [text, setText] = createSignal(current().automationInstructions ?? "");
    const [error, setError] = createSignal<string | null>(null);
    createEffect(on(() => current().automationInstructions, (t) => setText(t ?? "")));
    const save = () => {
        const next = text().trim();
        setError(null);
        props.agent
            .saveSettings((cur) => {
                if (next === (cur.automationInstructions ?? "")) return null;
                const { automationInstructions: _, ...rest } = cur;
                return next ? { ...rest, automationInstructions: next } : rest;
            })
            // what was typed stays in the field, to be saved again
            .catch((e) => setError(errorMessage(e)));
    };
    return (
        <PaperFlex gap="full" role="region" aria-label="Flows">
            <PaperSectionHeader icon="bolt" title="Flows" role="heading" aria-level={2} />
            <PaperSettingList autoHeight>
                <PaperSettingItem
                    title="Instructions for flows"
                    description={`When a flow in Actions messages or asks ${current().name}, these are added to what it's told. A flow's own instructions replace them.`}
                >
                    <PaperInput
                        name="automationInstructions"
                        label="Instructions for flows"
                        multiline
                        rows={4}
                        placeholder="Reply with just the answer, so the flow can use it as it is."
                        value={text()}
                        maxLength={LIMITS.instructions}
                        onInput={(e) => setText(e.currentTarget.value)}
                        onChange={save}
                    />
                </PaperSettingItem>
            </PaperSettingList>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="error" title="Instructions not saved" role="alert">
                    {error()}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}

/** The confirmation for starting over. */
function StartOver(props: { agent: Agent; open: boolean; onClose: () => void }) {
    const { busy, error, setError, run } = createAction();
    const name = () => props.agent.name();
    // each time it opens, it asks afresh
    createEffect(on(() => props.open, (open) => open && setError(null)));
    return (
        <PaperModal
            open={props.open}
            onClose={() => !busy() && props.onClose()}
            title="Start over?"
            size="small"
            footer={
                <>
                    <PaperButton variant="text" disabled={busy()} onClick={props.onClose}>
                        Keep talking
                    </PaperButton>
                    <PaperButton
                        variant="danger"
                        disabled={busy()}
                        onClick={() =>
                            void run("Conversation not cleared", async () => {
                                await props.agent.calls.startOver();
                                props.onClose();
                            })
                        }
                    >
                        Start over
                    </PaperButton>
                </>
            }
        >
            <PaperText preset="text">
                {name()} stops what it's doing and forgets your whole conversation. Its computer and what's on it stay. This can't be undone.
            </PaperText>
            <Show when={error()}>
                {(why) => (
                    <PaperQuote variant="danger" icon="error" title={why().title} role="alert">
                        {why().message}
                    </PaperQuote>
                )}
            </Show>
        </PaperModal>
    );
}
