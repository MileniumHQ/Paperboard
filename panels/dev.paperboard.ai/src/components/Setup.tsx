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
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    PaperWizard,
    PaperWizardStep,
    type LoaderStatus,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { call, closeProviderSetup, errorText, state } from "../lib/state";

type ProviderChoice = "ollama" | "custom";

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

/** Step 2 for Ollama: install it if missing, start it, then wait for ready. */
function OllamaStep() {
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
                                ? "Ollama is ready."
                                : state.runtime.status === "missing"
                                  ? "Downloading Ollama..."
                                  : "Starting Ollama..."
                        }
                    />
                </PaperLoaderGroup>
                <Show when={state.runtime.error && state.runtime.status === "error"}>
                    <PaperQuote variant="danger" icon="warning" title="Ollama stopped">
                        {state.runtime.error}
                    </PaperQuote>
                </Show>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Couldn't set up Ollama">
                        {error()}
                    </PaperQuote>
                </Show>
            </PaperFlex>
        </PaperCenteredInterface>
    );
}

interface CustomStepProps {
    baseUrl: string;
    apiKey: string;
    onBaseUrl: (value: string) => void;
    onApiKey: (value: string) => void;
}

/** Step 2 for a custom endpoint: URL plus an optional vault-stored key. */
function CustomStep(props: CustomStepProps) {
    const [testing, setTesting] = createSignal(false);
    const [result, setResult] = createSignal("");
    const [error, setError] = createSignal("");

    const test = async () => {
        setTesting(true);
        setResult("");
        setError("");
        try {
            const res = await call<{ models: number }>(UI_ACTION_IDS.testProvider, {
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
                <PaperText preset="title">Connect an endpoint</PaperText>
                <PaperFlex direction="column" gap="half" fullWidth>
                    <PaperInput
                        fullWidth
                        aria-label="Endpoint URL"
                        icon="language"
                        placeholder="http://127.0.0.1:1234"
                        value={props.baseUrl}
                        onInput={(e) => props.onBaseUrl(e.currentTarget.value)}
                    />
                    <PaperInput
                        fullWidth
                        aria-label="API key"
                        icon="lock"
                        placeholder="API key (optional)"
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

export interface SetupProps {
    onComplete?: () => void;
}

/**
 * Provider onboarding, two steps, mirroring the game server's wizard: choose
 * how the panel reaches a model, then set that choice up.
 */
export default function Setup(props: SetupProps) {
    const [choice, setChoice] = createSignal<ProviderChoice>(state.provider.id);
    const [baseUrl, setBaseUrl] = createSignal(state.provider.baseUrl);
    const [apiKey, setApiKey] = createSignal("");
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");

    const isCustom = () => choice() === "custom";
    const canFinish = () =>
        saving() ? false : isCustom() ? baseUrl().trim().length > 0 : state.runtime.status === "ready";

    const finish = async () => {
        setSaving(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.setProvider, {
                id: choice(),
                ...(isCustom() ? { baseUrl: baseUrl(), apiKey: apiKey() } : {}),
            });
            closeProviderSetup();
            props.onComplete?.();
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperWizard
            showProgress={false}
            finishLabel={saving() ? "Saving..." : "Finish Setup"}
            finishVariant="success"
            onComplete={() => void finish()}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface size="compact">
                    <PaperFlex direction="column" gap="half" fullWidth>
                        <PaperText preset="title">Choose a provider</PaperText>
                        <PaperText preset="body">
                            Pick how the AI panel reaches a model. You can
                            change this later in Settings.
                        </PaperText>
                        <PaperSelector
                            name="provider"
                            value={choice()}
                            onValueChange={(value) => setChoice(value as ProviderChoice)}
                        >
                            <PaperSelectorItem
                                value="ollama"
                                icon="memory"
                                description="Runs models locally on this computer. The panel installs and starts it for you."
                            >
                                Ollama
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="custom"
                                icon="cloud"
                                description="Point at any OpenAI-compatible endpoint by URL, with an optional API key."
                            >
                                Custom endpoint
                            </PaperSelectorItem>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={canFinish()}>
                <Show when={isCustom()} fallback={<OllamaStep />}>
                    <CustomStep
                        baseUrl={baseUrl()}
                        apiKey={apiKey()}
                        onBaseUrl={setBaseUrl}
                        onApiKey={setApiKey}
                    />
                </Show>
                <Show when={error()}>
                    <PaperQuote variant="danger" icon="warning" title="Couldn't save the provider">
                        {error()}
                    </PaperQuote>
                </Show>
            </PaperWizardStep>
        </PaperWizard>
    );
}
