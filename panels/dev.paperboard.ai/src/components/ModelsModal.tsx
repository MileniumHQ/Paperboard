// The model picker: a sidebar of the providers the user added, with the
// selected provider's own screen to its right, and Add provider at the end.

import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
    PaperButton,
    PaperIcon,
    PaperInterfaceGroup,
    PaperInterfaceItem,
    PaperMenu,
    PaperMenuItem,
    PaperModal,
    PaperPanel,
    PaperQuote,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import type { Connection } from "../core/providers";
import { call, errorText, state } from "../lib/state";
import AgentLogo from "./AgentLogo";
import ModelBrowser from "./ModelBrowser";
import OllamaRuntimeCard from "./OllamaRuntimeCard";
import { EndpointForm } from "./ProviderForms";
import ProviderWizard from "./ProviderWizard";
import { agentSidebarStatus, AgentStatus, EditCustomAgent } from "./AgentForms";
import styles from "./ModelsModal.module.css";

/** The sidebar entry that adds a provider; never a connection id. */
export const ADD_PROVIDER_PANE = "add";

export interface ModelsModalProps {
    open: boolean;
    onClose: () => void;
    onPick: (ref: string, provider: string) => void;
    /** the pane shown on open: a connection id or ADD_PROVIDER_PANE; else the first provider */
    initialPane?: string;
}

/** A provider's state in a few words, for the sidebar and settings. */
export function connectionStatus(c: Connection): string {
    if (c.kind === "agent") return agentSidebarStatus(c);
    if (state.modelErrors[c.id]) return "Unavailable";
    if (c.kind === "ollama" && state.runtime.status !== "ready") {
        return state.runtime.status === "missing" ? "Not installed" : state.runtime.status === "error" ? "Stopped" : "Not running";
    }
    const count = state.models.filter((m) => m.provider === c.id).length;
    return `${count} model${count === 1 ? "" : "s"}`;
}

export default function ModelsModal(props: ModelsModalProps) {
    const [pane, setPane] = createSignal(ADD_PROVIDER_PANE);
    createEffect(
        on(
            () => props.open,
            (open) => {
                if (open) setPane(props.initialPane ?? state.connections[0]?.id ?? ADD_PROVIDER_PANE);
            },
        ),
    );
    const current = () => state.connections.find((c) => c.id === pane());
    // a removed provider's pane falls back to the first one left
    createEffect(() => {
        if (pane() !== ADD_PROVIDER_PANE && !current()) setPane(state.connections[0]?.id ?? ADD_PROVIDER_PANE);
    });

    return (
        <PaperModal open={props.open} onClose={props.onClose} title="Models" size="large" noPadding>
            <PaperPanel class={styles.panel}>
                <PaperMenu name="model-provider" spacing="half" role="navigation" aria-label="Providers" value={pane()} onValueChange={(value) => setPane(String(value))}>
                    <For each={state.connections}>
                        {(c) => (
                            <PaperMenuItem value={c.id} icon={c.kind === "agent" ? <AgentLogo agent={c.agent} /> : c.kind === "ollama" ? "memory" : "cloud"} description={connectionStatus(c)}>
                                {c.label}
                            </PaperMenuItem>
                        )}
                    </For>
                    <PaperMenuItem value={ADD_PROVIDER_PANE} icon="add">
                        Add provider
                    </PaperMenuItem>
                </PaperMenu>
                <PaperInterfaceGroup value={pane()}>
                    <For each={state.connections}>
                        {(c) => (
                            <PaperInterfaceItem value={c.id}>
                                <ConnectionPane connection={c} onPick={props.onPick} />
                            </PaperInterfaceItem>
                        )}
                    </For>
                    <PaperInterfaceItem value={ADD_PROVIDER_PANE} variant="full">
                        <ProviderWizard finishLabel="Add provider" onDone={(id) => id && setPane(id)} />
                    </PaperInterfaceItem>
                </PaperInterfaceGroup>
            </PaperPanel>
        </PaperModal>
    );
}

function ConnectionPane(props: { connection: Connection; onPick: (ref: string, provider: string) => void }) {
    const [editing, setEditing] = createSignal(false);
    const [confirmRemove, setConfirmRemove] = createSignal(false);
    const [removing, setRemoving] = createSignal(false);
    const [retrying, setRetrying] = createSignal(false);
    const [error, setError] = createSignal("");
    const isEndpoint = () => props.connection.kind === "openai-compatible";
    const isAgent = () => props.connection.kind === "agent";
    const listError = () => state.modelErrors[props.connection.id];
    // editing one provider never carries over to the next one shown
    createEffect(on(() => props.connection.id, () => {
        setEditing(false);
        setError("");
    }));

    const retry = async () => {
        setRetrying(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.refreshModels);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setRetrying(false);
        }
    };

    const remove = async () => {
        setRemoving(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.removeConnection, { id: props.connection.id });
            setConfirmRemove(false);
        } catch (err) {
            setConfirmRemove(false);
            setError(errorText(err));
        } finally {
            setRemoving(false);
        }
    };

    return (
        <section class={styles.pane} aria-label={props.connection.label}>
            <div class={styles.paneHead}>
                <div class={styles.paneTitle}>
                    <PaperText preset="subtitle" truncate>{props.connection.label}</PaperText>
                    <PaperText size={1} color="text-muted" truncate>
                        {isEndpoint()
                            ? `${props.connection.baseUrl}${props.connection.hasApiKey ? " · API key stored" : ""}`
                            : isAgent()
                              ? "Coding agent on this computer"
                              : "Runs models on this computer"}
                    </PaperText>
                </div>
                <div class={styles.paneActions}>
                    <Show when={isEndpoint() || isAgent()}>
                        <PaperButton size="small" disabled={editing()} onClick={() => setEditing(true)}>
                            <PaperIcon>edit</PaperIcon> Edit
                        </PaperButton>
                    </Show>
                    <PaperButton size="small" variant="text" onClick={() => setConfirmRemove(true)}>
                        <PaperIcon>delete</PaperIcon> Remove
                    </PaperButton>
                </div>
            </div>

            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
            </Show>

            <Show when={editing()}>
                <Show when={isAgent()} fallback={<EditEndpoint connection={props.connection} onDone={() => setEditing(false)} />}>
                    <EditCustomAgent connection={props.connection} onDone={() => setEditing(false)} />
                </Show>
            </Show>

            <Show when={props.connection.kind === "ollama" && state.runtime.status !== "ready"}>
                <OllamaRuntimeCard />
            </Show>

            <Show when={isAgent()}>
                <AgentStatus connection={props.connection} />
            </Show>

            <Show
                when={!listError()}
                fallback={isAgent() ? undefined : (
                    <PaperQuote variant="danger" icon="cloud_off" title={`Couldn't list ${props.connection.label}'s models`}>
                        <PaperText size={2}>{listError()}</PaperText>
                        <div>
                            <PaperButton size="small" disabled={retrying()} onClick={() => void retry()}>
                                <PaperIcon>refresh</PaperIcon> {retrying() ? "Trying..." : "Try again"}
                            </PaperButton>
                        </div>
                    </PaperQuote>
                )}
            >
                <ModelBrowser provider={props.connection.id} mode="pick" manage onPick={props.onPick} />
            </Show>

            <PaperModal
                open={confirmRemove()}
                onClose={() => !removing() && setConfirmRemove(false)}
                title={`Remove ${props.connection.label}?`}
                size="small"
                footer={
                    <>
                        <PaperButton onClick={() => setConfirmRemove(false)} disabled={removing()}>Keep it</PaperButton>
                        <PaperButton variant="danger" onClick={() => void remove()} disabled={removing()}>Remove</PaperButton>
                    </>
                }
            >
                <PaperText>
                    {isAgent()
                        ? `${props.connection.label} stops and leaves the picker. It stays installed on this computer, and chats that used it stay.`
                        : isEndpoint()
                        ? `Its models leave the picker${props.connection.hasApiKey ? " and its stored API key is deleted" : ""}. Chats that used it stay.`
                        : "Local AI stops and its models leave the picker. The downloaded models stay on this computer and come back if you add Local AI again."}
                </PaperText>
            </PaperModal>
        </section>
    );
}

function EditEndpoint(props: { connection: Connection; onDone: () => void }) {
    const [label, setLabel] = createSignal(props.connection.label);
    const [baseUrl, setBaseUrl] = createSignal(props.connection.baseUrl ?? "");
    const [apiKey, setApiKey] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");

    const save = async () => {
        setSaving(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.updateConnection, { id: props.connection.id, label: label(), baseUrl: baseUrl(), apiKey: apiKey() });
            props.onDone();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <EndpointForm
                id={props.connection.id}
                label={label()}
                baseUrl={baseUrl()}
                apiKey={apiKey()}
                hasApiKey={props.connection.hasApiKey}
                onLabel={setLabel}
                onBaseUrl={setBaseUrl}
                onApiKey={setApiKey}
            />
            <Show when={baseUrl().trim() !== (props.connection.baseUrl ?? "") && props.connection.hasApiKey && !apiKey().trim()}>
                <PaperText size={2} color="warning">The stored API key belongs to the old URL and is deleted when you save.</PaperText>
            </Show>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
            </Show>
            <div class={styles.paneActions}>
                <PaperButton onClick={props.onDone} disabled={saving()}>Cancel</PaperButton>
                <PaperButton variant="primary" disabled={saving() || !baseUrl().trim()} onClick={() => void save()}>
                    {saving() ? "Saving..." : "Save"}
                </PaperButton>
            </div>
        </>
    );
}
