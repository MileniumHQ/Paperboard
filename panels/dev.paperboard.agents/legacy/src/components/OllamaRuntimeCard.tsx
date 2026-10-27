import { createSignal, Show } from "solid-js";
import { PaperButton, PaperCard, PaperIcon, PaperProgress, PaperText } from "@mileniumhq/paperui";
import { UI_ACTION_IDS } from "../contract";
import { formatBytes } from "../core/fit";
import { OLLAMA_PROVIDER } from "../core/providers";
import { call, errorText, state } from "../lib/state";

/** Ollama's runtime: whether it runs, what it computes on, and install/start. */
export default function OllamaRuntimeCard() {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const provider = () => OLLAMA_PROVIDER;
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
    );
}
