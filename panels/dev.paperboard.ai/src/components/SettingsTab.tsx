import { createSignal, Show } from "solid-js";
import {
    PaperButton,
    PaperCard,
    PaperFlex,
    PaperIcon,
    PaperPageHeader,
    PaperProgress,
    PaperSeparator,
    PaperText,
} from "@paperboard-dev/paperui";
import { formatBytes } from "../core/fit";
import { OLLAMA_PROVIDER_ID, providerFor } from "../core/providers";
import { UI_ACTION_IDS } from "../contract";
import { call, errorText, openProviderSetup, state } from "../lib/state";
import PermissionsView from "./PermissionsView";
import SettingsView from "./SettingsView";

/** The Settings tab: preferences and permissions, then the provider runtime. */
export default function SettingsTab() {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const provider = () => providerFor(state.provider.id);
    const usingOllama = () => state.provider.id === OLLAMA_PROVIDER_ID;
    const runtime = () => state.runtime;

    const run = async (action: typeof UI_ACTION_IDS.installRuntime | typeof UI_ACTION_IDS.startRuntime) => {
        setBusy(true);
        setError("");
        try {
            await call(action);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    const statusText = () => {
        const label = provider().label;
        switch (runtime().status) {
            case "ready":
                return `${label} is running${runtime().version ? ` (v${runtime().version})` : ""}.`;
            case "installing":
                return `Installing ${label}...`;
            case "starting":
                return `Starting ${label}...`;
            case "stopped":
                return `${label} is not running.`;
            case "missing":
                return `${label} is not installed.`;
            case "error":
                return runtime().error || `${label} stopped unexpectedly.`;
            default:
                return `Checking ${label}...`;
        }
    };

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
                <PaperText preset="subtitle">Provider</PaperText>
                <PaperText size={2} color="text-muted">
                    {usingOllama()
                        ? `${provider().label} runs models on this computer.`
                        : `${provider().label}: ${state.provider.baseUrl}${state.provider.hasApiKey ? " (API key stored)" : ""}`}
                </PaperText>
                <div>
                    <PaperButton onClick={openProviderSetup}>
                        <PaperIcon>swap_horiz</PaperIcon> Change provider
                    </PaperButton>
                </div>
            </PaperCard>

            <Show when={usingOllama()}>
            <PaperCard padding="full" gap="half">
                <PaperText preset="subtitle">{provider().label} runtime</PaperText>
                <PaperText size={2} color="text-muted">{statusText()}</PaperText>
                <Show when={runtime().status === "installing"}>
                    <PaperProgress
                        value={runtime().install?.percent ?? 0}
                        max={100}
                        aria-label={`Installing ${provider().label}`}
                    />
                </Show>
                <Show when={state.runtime.errorDetail}>
                    <PaperText size={1} color="text-faint">{state.runtime.errorDetail}</PaperText>
                </Show>
                <Show when={runtime().compute.length > 0}>
                    <PaperText size={2} color="text-muted">
                        Compute: {runtime().compute.map((d) => `${d.library} · ${d.name}${d.totalBytes ? ` (${formatBytes(d.totalBytes)})` : ""}`).join("  |  ")}
                    </PaperText>
                </Show>
                <div style={{ display: "flex", gap: "var(--paper-uigap-half)" }}>
                    <Show when={runtime().packageInstalled === false || runtime().status === "missing"}>
                        <PaperButton
                            variant="primary"
                            disabled={busy() || runtime().status === "installing"}
                            onClick={() => void run(UI_ACTION_IDS.installRuntime)}
                        >
                            <PaperIcon>download</PaperIcon> Install {provider().label}
                        </PaperButton>
                    </Show>
                    <Show when={runtime().packageInstalled !== false && runtime().status !== "ready"}>
                        <PaperButton
                            variant="primary"
                            disabled={busy() || runtime().status === "starting" || runtime().status === "installing"}
                            onClick={() => void run(UI_ACTION_IDS.startRuntime)}
                        >
                            <PaperIcon>play_arrow</PaperIcon> Start {provider().label}
                        </PaperButton>
                    </Show>
                </div>
                <Show when={error()}>
                    <PaperText size={2} color="danger" role="alert">{error()}</PaperText>
                </Show>
            </PaperCard>
            </Show>
        </PaperFlex>
    );
}
