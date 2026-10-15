// The model picker: a sidebar of the providers the user added, with the
// selected provider's own screen to its right, and Add provider at the end.

import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import {
    PaperButton,
    PaperIcon,
    PaperMenu,
    PaperMenuItem,
    PaperModal,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import type { Connection, ProviderKind } from "../core/providers";
import { call, errorText, state } from "../lib/state";
import ModelBrowser from "./ModelBrowser";
import OllamaRuntimeCard from "./OllamaRuntimeCard";
import { EndpointForm } from "./ProviderForms";
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

function connectionStatus(c: Connection): string {
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
        <PaperModal open={props.open} onClose={props.onClose} title="Models" size="large">
            <div class={styles.layout}>
                <nav class={styles.sidebar} aria-label="Providers">
                    <PaperMenu name="model-provider" value={pane()} onValueChange={(value) => setPane(String(value))}>
                        <For each={state.connections}>
                            {(c) => (
                                <PaperMenuItem value={c.id} icon={c.kind === "ollama" ? "memory" : "cloud"} description={connectionStatus(c)}>
                                    {c.label}
                                </PaperMenuItem>
                            )}
                        </For>
                        <PaperMenuItem value={ADD_PROVIDER_PANE} icon="add">
                            Add provider
                        </PaperMenuItem>
                    </PaperMenu>
                </nav>
                <Switch>
                    <Match when={pane() === ADD_PROVIDER_PANE}>
                        <AddProviderPane onAdded={setPane} />
                    </Match>
                    <Match when={current()}>
                        {(c) => <ConnectionPane connection={c()} onPick={props.onPick} />}
                    </Match>
                </Switch>
            </div>
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
                            : "Runs models on this computer"}
                    </PaperText>
                </div>
                <div class={styles.paneActions}>
                    <Show when={isEndpoint()}>
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
                <EditEndpoint connection={props.connection} onDone={() => setEditing(false)} />
            </Show>

            <Show when={props.connection.kind === "ollama" && state.runtime.status !== "ready"}>
                <OllamaRuntimeCard />
            </Show>

            <Show
                when={!listError()}
                fallback={
                    <PaperQuote variant="danger" icon="cloud_off" title={`Couldn't list ${props.connection.label}'s models`}>
                        <PaperText size={2}>{listError()}</PaperText>
                        <div>
                            <PaperButton size="small" disabled={retrying()} onClick={() => void retry()}>
                                <PaperIcon>refresh</PaperIcon> {retrying() ? "Trying..." : "Try again"}
                            </PaperButton>
                        </div>
                    </PaperQuote>
                }
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
                    {isEndpoint()
                        ? `Its models leave the picker${props.connection.hasApiKey ? " and its stored API key is deleted" : ""}. Chats that used it stay.`
                        : "Ollama stops and its models leave the picker. The downloaded models stay on this computer and come back if you add Ollama again."}
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

function AddProviderPane(props: { onAdded: (id: string) => void }) {
    const hasOllama = () => state.connections.some((c) => c.kind === "ollama");
    const [kind, setKind] = createSignal<ProviderKind>(hasOllama() ? "openai-compatible" : "ollama");
    const [label, setLabel] = createSignal("");
    const [baseUrl, setBaseUrl] = createSignal("");
    const [apiKey, setApiKey] = createSignal("");
    const [adding, setAdding] = createSignal(false);
    const [error, setError] = createSignal("");
    const isEndpoint = () => kind() === "openai-compatible";

    const add = async () => {
        setAdding(true);
        setError("");
        try {
            const added = await call<Connection>(UI_ACTION_IDS.addConnection, {
                kind: kind(),
                ...(isEndpoint() ? { label: label(), baseUrl: baseUrl(), apiKey: apiKey() } : {}),
            });
            props.onAdded(added.id);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setAdding(false);
        }
    };

    return (
        <section class={styles.pane} aria-label="Add provider">
            <PaperText preset="subtitle">Add provider</PaperText>
            <PaperSelector name="add-provider-kind" value={kind()} onValueChange={(value) => setKind(value as ProviderKind)}>
                <Show when={!hasOllama()}>
                    <PaperSelectorItem value="ollama" icon="memory" description="Runs models locally on this computer. The panel installs and starts it for you.">
                        Ollama
                    </PaperSelectorItem>
                </Show>
                <PaperSelectorItem value="openai-compatible" icon="cloud" description="Point at any OpenAI-compatible endpoint by URL, with an optional API key.">
                    Custom endpoint
                </PaperSelectorItem>
            </PaperSelector>
            <Show when={isEndpoint()}>
                <EndpointForm
                    label={label()}
                    baseUrl={baseUrl()}
                    apiKey={apiKey()}
                    onLabel={setLabel}
                    onBaseUrl={setBaseUrl}
                    onApiKey={setApiKey}
                />
            </Show>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Couldn't add the provider">
                    {error()}
                </PaperQuote>
            </Show>
            <div>
                <PaperButton variant="primary" disabled={adding() || (isEndpoint() && !baseUrl().trim())} onClick={() => void add()}>
                    <PaperIcon>add</PaperIcon> {adding() ? "Adding..." : "Add provider"}
                </PaperButton>
            </div>
        </section>
    );
}
