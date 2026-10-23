// The agent's settings: who it is, its brain, its computer and the
// conversation. Every change goes through the service, which validates it.

import { For, Match, Show, Switch, createResource, createSignal } from "solid-js";
import {
    PaperButton,
    PaperIcon,
    PaperInput,
    PaperModal,
    PaperPage,
    PaperPageHeader,
    PaperRange,
    PaperSelectMenu,
    PaperSelectMenuItem,
    PaperSettingItem,
    PaperSettingList,
    PaperText,
} from "@mileniumhq/paperui";
import AgentLogo from "../../legacy/src/components/AgentLogo";
import { Budget, DEFAULT_BUDGET } from "../computer/Computer";
import { HARNESSES, LIMITS, type ComputerBudget, type Harness } from "../contract";
import type { Agent } from "../lib/agent";
import { CLAUDE_MODELS, harnessName } from "../lib/brains";
import styles from "./Settings.module.css";

const DEFAULT_MODEL = "default";
const MEMORY_MARKS = [2, 4, 8, 12, 16, 24, 32];

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Settings(props: { agent: Agent }) {
    const { agent } = props;
    const settings = () => agent.state.settings!;
    const name = () => settings().name;

    return (
        <PaperPage class={styles.page}>
            <PaperPageHeader icon="settings" title="Settings" subtitle={`${name()}, its brain, its computer and your conversation.`} />
            <AgentSettings agent={agent} />
            <ComputerSettings agent={agent} />
            <ConversationSettings agent={agent} />
        </PaperPage>
    );
}

function AgentSettings(props: { agent: Agent }) {
    const current = () => props.agent.state.settings!;
    const [name, setName] = createSignal(current().name);
    const [harness, setHarness] = createSignal<Harness>(current().harness);
    const [model, setModel] = createSignal(current().model ?? "");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [installed] = createResource(() => props.agent.detect());

    const changed = () => name().trim() !== current().name || harness() !== current().harness || (model().trim() || null) !== current().model;
    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await props.agent.setup({ name: name().trim(), harness: harness(), model: model().trim() || null });
        } catch (e) {
            setError(message(e));
        } finally {
            setSaving(false);
        }
    };
    const isInstalled = (h: Harness) => installed()?.find((i) => i.id === h)?.installed ?? h === current().harness;

    return (
        <section class={styles.group} aria-labelledby="settings-agent">
            <PaperText as="h2" preset="subtitle" id="settings-agent">
                Agent
            </PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Name" description="What it's called, and what it calls itself.">
                    <PaperInput name="name" label="Name" value={name()} maxLength={LIMITS.name} onInput={(e) => setName(e.currentTarget.value)} />
                </PaperSettingItem>
                <PaperSettingItem title="Brain" description="The agent harness that thinks for it. Each keeps its own thread of your conversation.">
                    <PaperSelectMenu name="harness" aria-label="Brain" value={harness()} onValueChange={(v) => setHarness(v as Harness)}>
                        <For each={HARNESSES}>
                            {(h) => (
                                <PaperSelectMenuItem value={h} icon={<AgentLogo agent={h} />} disabled={!isInstalled(h)}>
                                    {harnessName(h)}
                                    {isInstalled(h) ? "" : " (not installed)"}
                                </PaperSelectMenuItem>
                            )}
                        </For>
                    </PaperSelectMenu>
                </PaperSettingItem>
                <PaperSettingItem title="Model" description="Leave it on the default to use whatever the harness is set to already.">
                    <Show
                        when={harness() === "claude-code"}
                        fallback={
                            <PaperInput
                                name="model"
                                label="Model"
                                placeholder="Default"
                                value={model()}
                                maxLength={LIMITS.model}
                                onInput={(e) => setModel(e.currentTarget.value)}
                            />
                        }
                    >
                        <PaperSelectMenu name="model" aria-label="Model" value={model() || DEFAULT_MODEL} onValueChange={(v) => setModel(v === DEFAULT_MODEL ? "" : String(v))}>
                            <PaperSelectMenuItem value={DEFAULT_MODEL} icon="tune">
                                Default
                            </PaperSelectMenuItem>
                            <For each={CLAUDE_MODELS}>{(m) => <PaperSelectMenuItem value={m.id}>{m.name}</PaperSelectMenuItem>}</For>
                        </PaperSelectMenu>
                    </Show>
                </PaperSettingItem>
            </PaperSettingList>
            <div class={styles.actions}>
                <PaperButton variant="primary" disabled={!changed() || saving() || !name().trim()} onClick={() => void save()}>
                    {saving() ? "Saving…" : "Save"}
                </PaperButton>
                <Show when={changed() && !saving()}>
                    <PaperButton
                        variant="text"
                        onClick={() => {
                            setName(current().name);
                            setHarness(current().harness);
                            setModel(current().model ?? "");
                            setError(null);
                        }}
                    >
                        Undo changes
                    </PaperButton>
                </Show>
            </div>
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
    const [note, setNote] = createSignal<string | null>(null);
    const [memory, setMemory] = createSignal<number | null>(null);
    const [fresh, setFresh] = createSignal<ComputerBudget>(DEFAULT_BUDGET);
    const [confirming, setConfirming] = createSignal(false);

    const act = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        setNote(null);
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
    const shownMemory = () => memory() ?? c().budget?.memoryGb ?? DEFAULT_BUDGET.memoryGb;
    const saveMemory = async (memoryGb: number) => {
        if (memoryGb === c().budget?.memoryGb) return;
        if (await act(() => props.agent.setMemory(memoryGb))) {
            setMemory(null);
            if (c().phase === "ready" || c().phase === "starting") setNote(`${name()}'s computer gets ${memoryGb} GB from its next start.`);
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
        <section class={styles.group} aria-labelledby="settings-computer">
            <PaperText as="h2" preset="subtitle" id="settings-computer">
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
                        <PaperSettingItem title={`${name()}'s own computer`} description="A Debian virtual machine it uses for its work. Nothing on yours is shared with it.">
                            <PaperButton variant="primary" disabled={busy()} onClick={() => void act(() => props.agent.installComputer(fresh()))}>
                                <PaperIcon>computer</PaperIcon> Set up
                            </PaperButton>
                        </PaperSettingItem>
                    </PaperSettingList>
                    <Budget name={name()} value={fresh()} onChange={setFresh} />
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
                        <PaperSettingItem title="Memory" description="The most it can use. It only takes what it needs.">
                            <PaperRange
                                label="Memory"
                                value={shownMemory()}
                                min={LIMITS.memoryGb.min}
                                max={LIMITS.memoryGb.max}
                                marks={MEMORY_MARKS.map((v) => ({ value: v, label: `${v}` }))}
                                snapToMarks
                                disabled={busy() || c().phase === "installing"}
                                formatValue={(v) => `${v} GB`}
                                onInput={setMemory}
                                onChange={(v) => void saveMemory(v)}
                            />
                        </PaperSettingItem>
                        <PaperSettingItem title="Storage" description="Fixed when the computer was set up. Setting it up again can change it.">
                            <PaperText size={2}>{c().budget?.diskGb ?? "?"} GB</PaperText>
                        </PaperSettingItem>
                        <PaperSettingItem title="Set up again" description={`Erases ${name()}'s computer, with everything on it, and builds a fresh one.`}>
                            <PaperButton
                                variant="danger"
                                disabled={busy() || c().phase === "installing"}
                                onClick={() => {
                                    setFresh(c().budget ?? DEFAULT_BUDGET);
                                    setConfirming(true);
                                }}
                            >
                                <PaperIcon>restart_alt</PaperIcon> Set up again
                            </PaperButton>
                        </PaperSettingItem>
                    </PaperSettingList>
                </Match>
            </Switch>
            <Show when={note()}>
                <PaperText size={2} color="text-muted" role="status">
                    {note()}
                </PaperText>
            </Show>
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
                                if (await act(() => props.agent.installComputer(fresh()))) setConfirming(false);
                            }}
                        >
                            Erase and set up
                        </PaperButton>
                    </>
                }
            >
                <PaperText>Everything on it is deleted: files, downloads, browser sign-ins. This can't be undone.</PaperText>
                <Budget name={name()} value={fresh()} onChange={setFresh} />
            </PaperModal>
        </section>
    );
}

function ConversationSettings(props: { agent: Agent }) {
    const [open, setOpen] = createSignal(false);
    return (
        <section class={styles.group} aria-labelledby="settings-conversation">
            <PaperText as="h2" preset="subtitle" id="settings-conversation">
                Conversation
            </PaperText>
            <PaperSettingList autoHeight>
                <PaperSettingItem title="Start over" description={`${props.agent.state.settings!.name} forgets the conversation and starts fresh.`}>
                    <PaperButton variant="danger" onClick={() => setOpen(true)}>
                        <PaperIcon>delete_sweep</PaperIcon> Start over
                    </PaperButton>
                </PaperSettingItem>
            </PaperSettingList>
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
