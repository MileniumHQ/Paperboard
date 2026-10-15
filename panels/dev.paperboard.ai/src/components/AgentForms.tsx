// Coding agents (ACP): choosing which installed ones to add, and an added
// agent's own screen. The panel never installs an agent; one that isn't on
// this computer shows the command that installs it.

import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCheckbox,
    PaperCode,
    PaperCopyButton,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperQuote,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { AGENT_REGISTRY, CUSTOM_AGENT_ID, installHint, splitArgs, type RegistryAgent } from "../core/agents";
import type { Connection } from "../core/providers";
import type { AgentState } from "../core/types";
import { call, errorText, state } from "../lib/state";
import styles from "./AgentForms.module.css";

export interface CustomAgentDraft {
    on: boolean;
    label: string;
    command: string;
    args: string;
}

export const emptyCustomAgent = (): CustomAgentDraft => ({ on: false, label: "", command: "", args: "" });


export function agentChoiceReady(selected: readonly string[], custom: CustomAgentDraft): boolean {
    return (selected.length > 0 || custom.on) && (!custom.on || custom.command.trim() !== "");
}

/**
 * Adds each chosen agent; stops at the first refusal, naming it. The custom
 * command goes first: it is the one that can be refused, and first-run setup
 * leaves as soon as one provider exists. Returns the last added id.
 */
export async function addAgents(selected: readonly string[], custom: CustomAgentDraft): Promise<string | undefined> {
    let last: string | undefined;
    if (custom.on) {
        const added = await call<Connection>(UI_ACTION_IDS.addConnection, {
            kind: "agent",
            agent: CUSTOM_AGENT_ID,
            label: custom.label,
            command: custom.command,
            args: splitArgs(custom.args),
        });
        last = added.id;
    }
    for (const agent of selected) {
        const added = await call<Connection>(UI_ACTION_IDS.addConnection, { kind: "agent", agent });
        last = added.id;
    }
    return last;
}

function InstallHint(props: { agent: RegistryAgent }) {
    const hint = () => installHint(props.agent);
    return (
        <div class={styles.hint}>
            <Show
                when={hint().command}
                fallback={
                    <>
                        <PaperText size={1} color="text-muted" truncate>{hint().url}</PaperText>
                        <PaperCopyButton text={hint().url ?? ""} title="Copy download link" aria-label={`Copy ${props.agent.name}'s download link`} />
                    </>
                }
            >
                <PaperCode>{hint().command}</PaperCode>
                <PaperCopyButton text={hint().command ?? ""} title="Copy install command" aria-label={`Copy ${props.agent.name}'s install command`} />
            </Show>
        </div>
    );
}

export interface AgentChooserProps {
    selected: string[];
    onSelected: (ids: string[]) => void;
    custom: CustomAgentDraft;
    onCustom: (draft: CustomAgentDraft) => void;
}

/**
 * Every agent found on this computer as a checkbox, a custom command, and
 * the rest of the ACP registry with how to install each.
 */
export function AgentChooser(props: AgentChooserProps) {
    const [installed, setInstalled] = createSignal<string[] | null>(null);
    const [error, setError] = createSignal("");
    const [showAll, setShowAll] = createSignal(false);
    const added = () => new Set(state.connections.filter((c) => c.kind === "agent").map((c) => c.agent));
    const found = () => AGENT_REGISTRY.filter((a) => installed()?.includes(a.id) && !added().has(a.id));
    const missing = () => AGENT_REGISTRY.filter((a) => !installed()?.includes(a.id) && !added().has(a.id));

    const look = async () => {
        setError("");
        setInstalled(null);
        try {
            setInstalled(await call<string[]>(UI_ACTION_IDS.installedAgents));
        } catch (err) {
            setError(errorText(err));
        }
    };
    onMount(() => void look());

    const toggle = (id: string, on: boolean) =>
        props.onSelected(on ? [...props.selected.filter((x) => x !== id), id] : props.selected.filter((x) => x !== id));

    return (
        <PaperFlex direction="column" gap="full" fullWidth>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't look for agents">
                    <PaperText size={2}>{error()}</PaperText>
                    <div>
                        <PaperButton size="small" onClick={() => void look()}>
                            <PaperIcon>refresh</PaperIcon> Try again
                        </PaperButton>
                    </div>
                </PaperQuote>
            </Show>
            <Show when={installed() !== null || error()} fallback={<PaperText color="text-muted">Looking for agents on this computer...</PaperText>}>
                <section class={styles.group} aria-label="Installed agents">
                    <PaperText preset="label">On this computer</PaperText>
                    <Show when={found().length > 0} fallback={<PaperText size={2} color="text-muted">No agents from the list below are installed{added().size > 0 ? " that aren't added already" : ""}.</PaperText>}>
                        <For each={found()}>
                            {(a) => (
                                <PaperCheckbox
                                    checked={props.selected.includes(a.id)}
                                    onChange={(on) => toggle(a.id, on)}
                                    label={a.name}
                                    description={a.description}
                                />
                            )}
                        </For>
                    </Show>
                    <PaperCheckbox
                        checked={props.custom.on}
                        onChange={(on) => props.onCustom({ ...props.custom, on })}
                        label="Another agent"
                        description="Any program that speaks the Agent Client Protocol over stdio."
                    />
                    <Show when={props.custom.on}>
                        <div class={styles.custom}>
                            <PaperInput
                                fullWidth
                                label="Command"
                                icon="terminal"
                                placeholder="my-agent or /full/path/to/my-agent"
                                value={props.custom.command}
                                onInput={(e) => props.onCustom({ ...props.custom, command: e.currentTarget.value })}
                            />
                            <PaperInput
                                fullWidth
                                label="Arguments (optional, separated by spaces)"
                                icon="data_array"
                                placeholder="--acp"
                                value={props.custom.args}
                                onInput={(e) => props.onCustom({ ...props.custom, args: e.currentTarget.value })}
                            />
                            <PaperInput
                                fullWidth
                                label="Name (optional)"
                                icon="label"
                                placeholder="The command's name"
                                value={props.custom.label}
                                onInput={(e) => props.onCustom({ ...props.custom, label: e.currentTarget.value })}
                            />
                        </div>
                    </Show>
                </section>
                <section class={styles.group} aria-label="Agents to install">
                    <PaperButton size="small" variant="text" aria-expanded={showAll()} onClick={() => setShowAll(!showAll())}>
                        <PaperIcon>{showAll() ? "expand_less" : "expand_more"}</PaperIcon>
                        {showAll() ? "Hide" : "Show"} {missing().length} more agent{missing().length === 1 ? "" : "s"} you can install
                    </PaperButton>
                    <Show when={showAll()}>
                        <PaperText size={1} color="text-muted">
                            Install one in a terminal on this computer, then check again. Paperboard never downloads agents for you.
                        </PaperText>
                        <div>
                            <PaperButton size="small" onClick={() => void look()}>
                                <PaperIcon>refresh</PaperIcon> Check again
                            </PaperButton>
                        </div>
                        <For each={missing()}>
                            {(a) => (
                                <div class={styles.missing}>
                                    <PaperText size={2}>{a.name}</PaperText>
                                    <PaperText size={1} color="text-muted">{a.description}</PaperText>
                                    <InstallHint agent={a} />
                                </div>
                            )}
                        </For>
                    </Show>
                </section>
            </Show>
        </PaperFlex>
    );
}

function statusText(s: AgentState | undefined, listError: string | undefined): string {
    if (listError) return "Not found";
    switch (s?.status) {
        case "starting":
            return "Starting...";
        case "ready":
            return "Running";
        case "auth-required":
            return "Needs sign-in";
        case "error":
            return "Couldn't start";
        default:
            return "Installed";
    }
}

/** A short status for the provider sidebar. */
export function agentSidebarStatus(c: Connection): string {
    return statusText(state.agents[c.id], state.modelErrors[c.id]);
}

/** An added agent: whether it runs, sign-in, and starting a chat with it. */
export function AgentStatus(props: { connection: Connection; onPick: (ref: string, provider: string) => void }) {
    const [busy, setBusy] = createSignal("");
    const [error, setError] = createSignal("");
    const agent = () => state.agents[props.connection.id];
    const listError = () => state.modelErrors[props.connection.id];
    const model = () => state.models.find((m) => m.provider === props.connection.id);

    const run = async (what: string, action: () => Promise<unknown>) => {
        setBusy(what);
        setError("");
        try {
            await action();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy("");
        }
    };
    const check = () => run("check", () => call(UI_ACTION_IDS.checkAgent, { id: props.connection.id }));
    const signIn = (methodId: string) =>
        run(`auth:${methodId}`, () => call(UI_ACTION_IDS.authenticateAgent, { id: props.connection.id, methodId }));

    return (
        <PaperFlex direction="column" gap="full" fullWidth>
            <Show when={listError()}>
                <PaperQuote variant="danger" icon="search_off" title={`${props.connection.label} isn't available`}>
                    <PaperText size={2}>{listError()}</PaperText>
                    <div>
                        <PaperButton size="small" disabled={busy() !== ""} onClick={() => void check()}>
                            <PaperIcon>refresh</PaperIcon> {busy() === "check" ? "Checking..." : "Check again"}
                        </PaperButton>
                    </div>
                </PaperQuote>
            </Show>
            <Show when={!listError() && agent()?.status === "error"}>
                <PaperQuote variant="danger" icon="error" title={`${props.connection.label} stopped`}>
                    <PaperText size={2}>{agent()?.error}</PaperText>
                    <Show when={agent()?.errorDetail}>
                        <PaperCode block>{agent()?.errorDetail}</PaperCode>
                    </Show>
                    <div>
                        <PaperButton size="small" disabled={busy() !== ""} onClick={() => void check()}>
                            <PaperIcon>refresh</PaperIcon> {busy() === "check" ? "Starting..." : "Try again"}
                        </PaperButton>
                    </div>
                </PaperQuote>
            </Show>
            <Show when={agent()?.status === "auth-required"}>
                <PaperQuote variant="warning" icon="key" title={`Sign in to ${props.connection.label}`}>
                    <PaperText size={2}>
                        {agent()?.error ?? "The agent needs you to sign in before it can work."}
                    </PaperText>
                    <Show
                        when={(agent()?.authMethods ?? []).length > 0}
                        fallback={<PaperText size={2}>Sign in with the agent's own command in a terminal, then try again.</PaperText>}
                    >
                        <div class={styles.actions}>
                            <For each={agent()?.authMethods}>
                                {(m) => (
                                    <PaperButton size="small" title={m.description} disabled={busy() !== ""} onClick={() => void signIn(m.id)}>
                                        {busy() === `auth:${m.id}` ? "Signing in..." : m.name}
                                    </PaperButton>
                                )}
                            </For>
                        </div>
                    </Show>
                </PaperQuote>
            </Show>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
            </Show>
            <PaperFlex direction="column" gap="half" fullWidth>
                <PaperText size={2}>
                    {statusText(agent(), listError())}
                    {agent()?.name ? ` · ${agent()!.name}${agent()?.version ? ` ${agent()!.version}` : ""}` : ""}
                </PaperText>
                <PaperText size={1} color="text-muted">
                    The agent works in a folder you choose for each chat, with the files and commands it can reach on this computer. It asks before it changes things, unless you tell it not to.
                </PaperText>
            </PaperFlex>
            <div class={styles.actions}>
                <PaperButton variant="primary" disabled={!model()} onClick={() => props.onPick(model()!.name, props.connection.id)}>
                    <PaperIcon>chat</PaperIcon> Chat with {props.connection.label}
                </PaperButton>
                <Show when={!listError() && agent()?.status !== "error"}>
                    <PaperButton disabled={busy() !== ""} onClick={() => void check()}>
                        <PaperIcon>play_arrow</PaperIcon> {busy() === "check" ? "Checking..." : "Check it starts"}
                    </PaperButton>
                </Show>
            </div>
        </PaperFlex>
    );
}

/** A custom agent's command and arguments, edited in place. */
export function EditCustomAgent(props: { connection: Connection; onDone: () => void }) {
    const [label, setLabel] = createSignal(props.connection.label);
    const [command, setCommand] = createSignal(props.connection.command ?? "");
    const [args, setArgs] = createSignal((props.connection.args ?? []).join(" "));
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");
    const custom = () => props.connection.agent === CUSTOM_AGENT_ID;

    const save = async () => {
        setSaving(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.updateConnection, {
                id: props.connection.id,
                label: label(),
                ...(custom() ? { command: command(), args: splitArgs(args()) } : {}),
            });
            props.onDone();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperFlex direction="column" gap="half" fullWidth>
            <PaperInput fullWidth label="Name" icon="label" value={label()} onInput={(e) => setLabel(e.currentTarget.value)} />
            <Show when={custom()}>
                <PaperInput fullWidth label="Command" icon="terminal" value={command()} onInput={(e) => setCommand(e.currentTarget.value)} />
                <PaperInput
                    fullWidth
                    label="Arguments (separated by spaces)"
                    icon="data_array"
                    value={args()}
                    onInput={(e) => setArgs(e.currentTarget.value)}
                />
            </Show>
            <PaperText size={1} color="text-muted">Saving restarts the agent.</PaperText>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
            </Show>
            <div class={styles.actions}>
                <PaperButton onClick={props.onDone} disabled={saving()}>Cancel</PaperButton>
                <PaperButton variant="primary" disabled={saving() || (custom() && !command().trim())} onClick={() => void save()}>
                    {saving() ? "Saving..." : "Save"}
                </PaperButton>
            </div>
        </PaperFlex>
    );
}
