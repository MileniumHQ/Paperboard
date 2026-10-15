// Coding agents (ACP): choosing which installed ones to add, and the states
// an added agent's pane needs a recovery action for. The panel never installs
// an agent; it lists the ones it finds on this computer.

import { createSignal, For, onMount, Show } from "solid-js";
import {
    PaperButton,
    PaperCode,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { AGENT_REGISTRY, CUSTOM_AGENT_ID, splitArgs } from "../core/agents";
import type { Connection } from "../core/providers";
import type { AgentState } from "../core/types";
import { call, errorText, state } from "../lib/state";
import AgentLogo from "./AgentLogo";
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

export interface AgentChooserProps {
    selected: string[];
    onSelected: (ids: string[]) => void;
    custom: CustomAgentDraft;
    onCustom: (draft: CustomAgentDraft) => void;
}

/** Every agent found on this computer to choose from, and a custom command. */
export function AgentChooser(props: AgentChooserProps) {
    const [installed, setInstalled] = createSignal<string[] | null>(null);
    const [error, setError] = createSignal("");
    const added = () => new Set(state.connections.filter((c) => c.kind === "agent").map((c) => c.agent));
    const found = () => AGENT_REGISTRY.filter((a) => installed()?.includes(a.id) && !added().has(a.id));

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

    // the custom command is one more choice in the same list
    const chosen = () => (props.custom.on ? [...props.selected, CUSTOM_AGENT_ID] : props.selected);
    const choose = (values: (string | number)[]) => {
        const ids = values.map(String);
        props.onSelected(ids.filter((id) => id !== CUSTOM_AGENT_ID));
        if (ids.includes(CUSTOM_AGENT_ID) !== props.custom.on) props.onCustom({ ...props.custom, on: !props.custom.on });
    };

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
                    <Show when={found().length === 0}>
                        <PaperText size={2} color="text-muted">No agents found on this computer{added().size > 0 ? " that aren't added already" : ""}.</PaperText>
                    </Show>
                    <PaperSelector name="agents" multiple values={chosen()} onValuesChange={choose}>
                        <For each={found()}>
                            {(a) => (
                                <PaperSelectorItem value={a.id} icon={<AgentLogo agent={a.id} />} description={a.description}>
                                    {a.name}
                                </PaperSelectorItem>
                            )}
                        </For>
                        <PaperSelectorItem value={CUSTOM_AGENT_ID} icon="add" description="Any program that speaks the Agent Client Protocol over stdio.">
                            Another agent
                        </PaperSelectorItem>
                    </PaperSelector>
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

/**
 * An added agent's states that need the user: not found, stopped, or waiting
 * for sign-in, each with its recovery action. Nothing shows while it works;
 * its models are listed below, like Local AI's.
 */
export function AgentStatus(props: { connection: Connection }) {
    const [busy, setBusy] = createSignal("");
    const [error, setError] = createSignal("");
    const agent = () => state.agents[props.connection.id];
    const listError = () => state.modelErrors[props.connection.id];

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
        <>
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
                        fallback={
                            <>
                                <PaperText size={2}>Sign in with the agent's own command in a terminal, then try again.</PaperText>
                                <div>
                                    <PaperButton size="small" disabled={busy() !== ""} onClick={() => void check()}>
                                        <PaperIcon>refresh</PaperIcon> {busy() === "check" ? "Starting..." : "Try again"}
                                    </PaperButton>
                                </div>
                            </>
                        }
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
        </>
    );
}

