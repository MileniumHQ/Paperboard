import { For, Show } from "solid-js";
import { PaperButton, PaperCard, PaperFlex, PaperIcon, PaperPageHeader, PaperSeparator, PaperText } from "@mileniumhq/paperui";
import { state } from "../lib/state";
import OllamaRuntimeCard from "./OllamaRuntimeCard";
import PermissionsView from "./PermissionsView";
import SettingsView from "./SettingsView";

/** The Settings tab: preferences and permissions, then the providers. */
export default function SettingsTab(props: { onManageProviders: () => void }) {
    const connections = () => state.connections;
    const hasOllama = () => connections().some((c) => c.kind === "ollama");

    return (
        <PaperFlex direction="column" gap="full" fullWidth>
            <PaperPageHeader icon="settings" title="Settings" />

            <Show when={state.storageError}>
                <PaperText color="warning" role="status">{state.storageError}</PaperText>
            </Show>

            <SettingsView />
            <PaperSeparator />
            <PermissionsView />
            <PaperSeparator />
            <PaperCard padding="full" gap="half">
                <PaperText preset="subtitle">Providers</PaperText>
                <For each={connections()}>
                    {(c) => (
                        <PaperText size={2} color="text-muted">
                            {c.kind === "ollama"
                                ? `${c.label} runs models on this computer.`
                                : `${c.label}: ${c.baseUrl}${c.hasApiKey ? " (API key stored)" : ""}`}
                        </PaperText>
                    )}
                </For>
                <div>
                    <PaperButton onClick={props.onManageProviders}>
                        <PaperIcon>tune</PaperIcon> Manage providers
                    </PaperButton>
                </div>
            </PaperCard>

            <Show when={hasOllama()}>
                <OllamaRuntimeCard />
            </Show>
        </PaperFlex>
    );
}
