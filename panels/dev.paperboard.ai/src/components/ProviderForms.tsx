// The forms that add a provider, shared by first-run setup and the model
// picker's Add provider pane.

import { createEffect, createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperCenteredInterface,
    PaperFlex,
    PaperIcon,
    PaperInput,
    PaperLoader,
    PaperLoaderGroup,
    PaperQuote,
    PaperText,
    type LoaderStatus,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { call, errorText, state } from "../lib/state";

const STEP_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Maps the Ollama runtime state onto one install/start loader row. */
function loaderStatus(): LoaderStatus {
    switch (state.runtime.status) {
        case "ready":
            return "success";
        case "error":
            return "error";
        case "installing":
        case "starting":
            return "loading";
        case "checking":
            return "indeterminate";
        default:
            return "waiting";
    }
}

function loaderPercent(): number {
    if (state.runtime.status === "ready") return 100;
    return state.runtime.install?.percent ?? 0;
}

/** Installs Ollama if missing, starts it, then waits for ready. */
export function OllamaSetup() {
    const [error, setError] = createSignal("");
    // read through a call so TypeScript does not narrow away the "ready"
    // branch across the awaits below
    const status = () => state.runtime.status;

    const begin = async () => {
        setError("");
        try {
            if (status() === "ready") return;
            // hydration can land just before the first package check
            let tries = 0;
            while (status() === "checking" && tries < 50) {
                await sleep(STEP_MS);
                tries++;
            }
            if (status() === "ready") return;
            const action =
                state.runtime.packageInstalled === false || status() === "missing"
                    ? UI_ACTION_IDS.installRuntime
                    : UI_ACTION_IDS.startRuntime;
            await call(action);
        } catch (err) {
            setError(errorText(err));
        }
    };

    let started = false;
    createEffect(() => {
        if (started) return;
        started = true;
        void begin();
    });

    return (
        <PaperCenteredInterface size="compact">
            <PaperFlex direction="column" gap="full" center fullWidth>
                <PaperLoaderGroup>
                    <PaperLoader
                        percent={loaderPercent()}
                        loaderStatus={loaderStatus()}
                        label={
                            state.runtime.status === "ready"
                                ? "Local AI is ready."
                                : state.runtime.status === "missing"
                                  ? "Downloading Local AI..."
                                  : "Starting Local AI..."
                        }
                    />
                </PaperLoaderGroup>
                <Show when={state.runtime.error && state.runtime.status === "error"}>
                    <PaperQuote variant="danger" icon="warning" title="Local AI stopped">
                        {state.runtime.error}
                    </PaperQuote>
                </Show>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Couldn't set up Local AI">
                        {error()}
                    </PaperQuote>
                </Show>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

export interface EndpointFormProps {
    /** set when editing a saved endpoint, so a test can use its stored key */
    id?: string;
    title?: string;
    label: string;
    baseUrl: string;
    apiKey: string;
    /** an API key is already stored; an empty field keeps it */
    hasApiKey?: boolean;
    onLabel: (value: string) => void;
    onBaseUrl: (value: string) => void;
    onApiKey: (value: string) => void;
}

/** An OpenAI-compatible endpoint: name, URL, and an optional vault-stored key. */
export function EndpointForm(props: EndpointFormProps) {
    const [testing, setTesting] = createSignal(false);
    const [result, setResult] = createSignal("");
    const [error, setError] = createSignal("");

    const test = async () => {
        setTesting(true);
        setResult("");
        setError("");
        try {
            const res = await call<{ models: number }>(UI_ACTION_IDS.testConnection, {
                ...(props.id ? { id: props.id } : {}),
                baseUrl: props.baseUrl,
                apiKey: props.apiKey,
            });
            setResult(`Connected. ${res.models} model${res.models === 1 ? "" : "s"} available.`);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setTesting(false);
        }
    };

    return (
        <PaperCenteredInterface size="compact">
            <PaperFlex direction="column" gap="full" center fullWidth>
                <Show when={props.title}>
                    <PaperText preset="title">{props.title}</PaperText>
                </Show>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        label="Name (optional)"
                        icon="label"
                        placeholder={props.baseUrl.trim() ? "Its host name" : "LM Studio"}
                        value={props.label}
                        onInput={(e) => props.onLabel(e.currentTarget.value)}
                    />
                    <PaperInput
                        fullWidth
                        label="Endpoint URL"
                        icon="language"
                        placeholder="http://127.0.0.1:1234"
                        value={props.baseUrl}
                        onInput={(e) => props.onBaseUrl(e.currentTarget.value)}
                    />
                    <PaperInput
                        fullWidth
                        label={props.hasApiKey ? "API key (stored; type to replace)" : "API key (optional)"}
                        icon="lock"
                        type="password"
                        autocomplete="off"
                        value={props.apiKey}
                        onInput={(e) => props.onApiKey(e.currentTarget.value)}
                    />
                </PaperFlex>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperButton
                        onClick={() => void test()}
                        disabled={!props.baseUrl.trim() || testing()}
                    >
                        <PaperIcon>network_check</PaperIcon>
                        {testing() ? "Testing..." : "Test connection"}
                    </PaperButton>
                    <Show when={result()}>
                        <PaperText size={2} color="success">{result()}</PaperText>
                    </Show>
                    <Show when={error()}>
                        <PaperQuote variant="danger" icon="warning" title="Couldn't reach the endpoint">
                            {error()}
                        </PaperQuote>
                    </Show>
                </PaperFlex>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}
