import { createSignal, Match, Show, Switch } from "solid-js";
import { PaperButton, PaperCode, PaperIcon, PaperLoader, PaperText } from "@paperboard-dev/paperui";
import { OLLAMA_PROVIDER_ID } from "../core/providers";
import { UI_ACTION_IDS } from "../contract";
import { call, errorText, state } from "../lib/state";
import styles from "./RuntimeBanner.module.css";

/** Ollama's state when it is not simply ready, with the way forward. */
export default function RuntimeBanner() {
    const [busy, setBusy] = createSignal(false);
    const [error, setError] = createSignal("");
    const [details, setDetails] = createSignal(false);

    const start = async () => {
        setBusy(true);
        setError("");
        try {
            await call(UI_ACTION_IDS.startRuntime);
        } catch (err) {
            setError(errorText(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Show when={state.provider.id === OLLAMA_PROVIDER_ID && state.runtime.status !== "ready"}>
            <div class={styles.RuntimeBanner} data-status={state.runtime.status} role="status">
                <Switch>
                    <Match when={state.runtime.status === "checking" || state.runtime.status === "starting"}>
                        <PaperLoader loaderStatus="indeterminate" size="small" label={state.runtime.status === "checking" ? "Looking for Ollama" : "Starting Ollama"} />
                    </Match>
                    <Match when={state.runtime.status === "stopped"}>
                        <PaperIcon>pause_circle</PaperIcon>
                        <PaperText weight={600} class={styles.grow}>Ollama is stopped. Chats and downloads need it running.</PaperText>
                        <PaperButton variant="primary" size="small" disabled={busy()} onClick={start}>Start Ollama</PaperButton>
                    </Match>
                    <Match when={state.runtime.status === "error"}>
                        <PaperIcon>error</PaperIcon>
                        <div class={styles.grow}>
                            <PaperText weight={600}>{state.runtime.error || "Ollama stopped working."}</PaperText>
                            <Show when={state.runtime.errorDetail}>
                                <button type="button" class={styles.link} aria-expanded={details()} onClick={() => setDetails(!details())}>
                                    {details() ? "Hide Ollama's output" : "Show Ollama's output"}
                                </button>
                            </Show>
                        </div>
                        <PaperButton variant="primary" size="small" disabled={busy()} onClick={start}>Restart Ollama</PaperButton>
                    </Match>
                </Switch>
            </div>
            <Show when={details() && state.runtime.errorDetail}>
                <PaperCode block class={styles.detail}>{state.runtime.errorDetail}</PaperCode>
            </Show>
            <Show when={error()}>
                <PaperText size={2} color="danger" role="alert" class={styles.error}>{error()}</PaperText>
            </Show>
        </Show>
    );
}
