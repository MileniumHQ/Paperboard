import { createSignal, Show } from "solid-js";
import {
    PaperFlex,
    PaperButton,
    PaperInput,
    PaperText,
    PaperQuote,
} from "@paperboard-dev/paperui";
import { actionsApi } from "@paperboard-dev/paperapi";

const PANEL_ID = "dev.paperboard.ai";

export default function EchoPage() {
    const [name, setName] = createSignal("");
    const [result, setResult] = createSignal("");
    const [error, setError] = createSignal("");
    const [busy, setBusy] = createSignal(false);

    const ask = async () => {
        if (busy()) return;
        setBusy(true);
        setError("");
        setResult("");
        try {
            // every service call passes the panel id explicitly; a failure
            // surfaces as text, never a silent success
            const greeting = await actionsApi.call<string>(PANEL_ID, "greet", {
                name: name(),
            });
            setResult(greeting ?? "");
        } catch (err) {
            console.error("[Echo] greet failed:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <PaperFlex direction="column" gap="half" padding="full">
            <PaperText preset="title">Echo</PaperText>
            <PaperText preset="body">
                Calls the panel service's greet action and shows the answer.
            </PaperText>
            <PaperInput
                fullWidth
                placeholder="Ada"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") void ask();
                }}
            />
            <PaperFlex direction="row" gap="half">
                <PaperButton size="small" disabled={busy()} onClick={() => void ask()}>
                    {busy() ? "Asking…" : "Ask the service"}
                </PaperButton>
            </PaperFlex>
            <Show when={result()}>
                <PaperText size={4}>{result()}</PaperText>
            </Show>
            <Show when={error()}>
                <PaperQuote variant="danger" icon="warning" title="Service error">
                    {error()}
                </PaperQuote>
            </Show>
        </PaperFlex>
    );
}
