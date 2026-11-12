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
import type { Connection, ProviderKind } from "../core/providers";
import { call, errorText, state } from "../lib/state";
import { EndpointForm, OllamaSetup } from "./ProviderForms";
import { addAgents, agentChoiceReady, AgentChooser, emptyCustomAgent } from "./AgentForms";

export interface ProviderWizardProps {
    finishLabel: string;
    /** called with the id of the provider added last */
    onDone?: (id: string | undefined) => void;
}

/**
 * Adding a provider, in two steps: choose how the panel reaches a model,
 * then set that up. First-run setup and Models' "Add provider" are this.
 */
export default function ProviderWizard(props: ProviderWizardProps) {
    const hasLocal = () => state.connections.some((c) => c.kind === "ollama");
    const [choice, setChoice] = createSignal<ProviderKind>(hasLocal() ? "agent" : "ollama");
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
            const id = isAgent()
                ? await addAgents(agents(), custom())
                : (
                      await call<Connection>(UI_ACTION_IDS.addConnection, {
                          kind: choice(),
                          ...(isEndpoint() ? { label: label(), baseUrl: baseUrl(), apiKey: apiKey() } : {}),
                      })
                  ).id;
            props.onDone?.(id);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <PaperWizard
            showProgress={false}
            finishLabel={saving() ? "Saving..." : props.finishLabel}
            finishVariant="success"
            onComplete={() => void finish()}
        >
            <PaperWizardStep index={0}>
                <PaperCenteredInterface size="compact">
                    <PaperFlex direction="column" gap="half" fullWidth>
                        <PaperText preset="title">Choose a provider</PaperText>
                        <PaperText preset="body">
                            Pick how the AI panel reaches a model. You can add
                            more providers any time from Models.
                        </PaperText>
                        <PaperSelector
                            name="provider"
                            value={choice()}
                            onValueChange={(value) => setChoice(value as ProviderKind)}
                        >
                            <Show when={!hasLocal()}>
                                <PaperSelectorItem
                                    value="ollama"
                                    icon="memory"
                                    description="Runs models on this computer. The panel installs and starts it for you."
                                >
                                    Local AI
                                </PaperSelectorItem>
                            </Show>
                            <PaperSelectorItem
                                value="agent"
                                icon="terminal"
                                description="Coding agents you installed, like Codex, Claude Code or OpenCode. Pick as many as you like."
                            >
                                Coding agents
                            </PaperSelectorItem>
                            <PaperSelectorItem
                                value="openai-compatible"
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
                    <PaperQuote variant="danger" icon="warning" title="Couldn't add the provider">
                        {error()}
                    </PaperQuote>
                </Show>
            </PaperWizardStep>
        </PaperWizard>
    );
}
