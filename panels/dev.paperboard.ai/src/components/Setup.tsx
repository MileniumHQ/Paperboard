import { createSignal, Show } from "solid-js";
import {
    PaperCenteredInterface,
    PaperFlex,
    PaperQuote,
    PaperSelector,
    PaperSelectorItem,
    PaperText,
    PaperWizard,
    PaperWizardStep,
} from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import type { ProviderKind } from "../core/providers";
import { call, errorText, state } from "../lib/state";
import { EndpointForm, OllamaSetup } from "./ProviderForms";
import { addAgents, agentChoiceReady, AgentChooser, emptyCustomAgent } from "./AgentForms";

export interface SetupProps {
    onComplete?: () => void;
}

/**
 * Provider onboarding, two steps, mirroring the game server's wizard: choose
 * how the panel reaches a model, then set that choice up.
 */
export default function Setup(props: SetupProps) {
    const [choice, setChoice] = createSignal<ProviderKind>("ollama");
    const [label, setLabel] = createSignal("");
    const [baseUrl, setBaseUrl] = createSignal("");
    const [apiKey, setApiKey] = createSignal("");
    const [agents, setAgents] = createSignal<string[]>([]);
    const [custom, setCustom] = createSignal(emptyCustomAgent());
    const [saving, setSaving] = createSignal(false);
    const [error, setError] = createSignal("");

    const isEndpoint = () => choice() === "openai-compatible";
    const isAgent = () => choice() === "agent";
    const canFinish = () =>
        saving()
            ? false
            : isEndpoint()
              ? baseUrl().trim().length > 0
              : isAgent()
                ? agentChoiceReady(agents(), custom())
                : state.runtime.status === "ready";

    const finish = async () => {
        setSaving(true);
        setError("");
        try {
            if (isAgent()) {
                await addAgents(agents(), custom());
                props.onComplete?.();
                return;
            }
            await call(UI_ACTION_IDS.addConnection, {
                kind: choice(),
                ...(isEndpoint() ? { label: label(), baseUrl: baseUrl(), apiKey: apiKey() } : {}),
            });
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
                            Pick how the AI panel reaches a model. You can add
                            more providers later from the model picker.
                        </PaperText>
                        <PaperSelector
                            name="provider"
                            value={choice()}
                            onValueChange={(value) => setChoice(value as ProviderKind)}
                        >
                            <PaperSelectorItem
                                value="ollama"
                                icon="memory"
                                description="Runs models locally on this computer. The panel installs and starts it for you."
                            >
                                Ollama
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="openai-compatible"
                                icon="cloud"
                                description="Point at any OpenAI-compatible endpoint by URL, with an optional API key."
                            >
                                Custom endpoint
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="agent"
                                icon="terminal"
                                description="Coding agents you installed, like Claude Agent, Codex or Gemini CLI. Pick as many as you like."
                            >
                                Coding agents
                            </PaperSelectorItem>
                        </PaperSelector>
                    </PaperFlex>
                </PaperCenteredInterface>
            </PaperWizardStep>

            <PaperWizardStep index={1} canProceed={canFinish()}>
                <Show when={isAgent()}>
                    <PaperCenteredInterface size="compact">
                        <PaperFlex direction="column" gap="full" fullWidth>
                            <PaperText preset="title">Choose your agents</PaperText>
                            <AgentChooser selected={agents()} onSelected={setAgents} custom={custom()} onCustom={setCustom} />
                        </PaperFlex>
                    </PaperCenteredInterface>
                </Show>
                <Show when={isEndpoint()} fallback={isAgent() ? undefined : <OllamaSetup />}>
                    <EndpointForm
                        title="Connect an endpoint"
                        label={label()}
                        baseUrl={baseUrl()}
                        apiKey={apiKey()}
                        onLabel={setLabel}
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
