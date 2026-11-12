// A page backed by the panel's service. The service owns the state; the page
// mirrors it through the bridge, so a greeting given in one window (or by
// another panel's Greet block) shows up in every window at once.
import { createSignal, onCleanup, Show } from "solid-js";
import { PaperButton, PaperCard, PaperEmptyState, PaperFlex, PaperIcon, PaperInput, PaperPageHeader, PaperQuote, PaperText } from "@mileniumhq/paperui";
import { createPanelBridge } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "../panel";
import { errorMessage } from "../lib/failure";

export default function ServicePage() {
    const bridge = createPanelBridge<PanelState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });
    const [state, setState] = createSignal<PanelState>(bridge.getState());
    // unavailable is not empty: a service that has not answered is said, with a way to try again
    const [hydration, setHydration] = createSignal<"loading" | "ready" | "failed">("loading");
    const [hydrationError, setHydrationError] = createSignal("");
    const [name, setName] = createSignal("");
    const [greeting, setGreeting] = createSignal("");
    const [failure, setFailure] = createSignal("");
    const [busy, setBusy] = createSignal(false);

    const off = bridge.onStateChange((_patch, full) => setState({ ...full }));
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const hydrate = async () => {
        setHydration("loading");
        try {
            setState({ ...(await bridge.refreshState()) });
            setHydration("ready");
        } catch (err) {
            setHydrationError(errorMessage(err));
            setHydration("failed");
        }
    };
    void hydrate();

    const greet = async () => {
        if (busy()) return;
        setBusy(true);
        setFailure("");
        setGreeting("");
        try {
            // the service refuses a bad name with a reason; the new count
            // arrives through its state, not through this answer
            setGreeting((await bridge.call<string>("greet", name())) ?? "");
        } catch (err) {
            console.error("[Service] greet failed:", err);
            setFailure(errorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PaperPageHeader icon="sync_alt" title="Service" subtitle="Asks the panel's background service and mirrors what it keeps" />
            <Show when={hydration() === "ready"} fallback={
                <PaperEmptyState
                    icon={hydration() === "failed" ? "cloud_off" : "hourglass_empty"}
                    title={hydration() === "failed" ? "The service is not answering" : "Connecting to the service"}
                    description={hydration() === "failed" ? hydrationError() : undefined}
                >
                    <Show when={hydration() === "failed"}>
                        <PaperButton onClick={() => void hydrate()}>
                            <PaperIcon>refresh</PaperIcon> Try again
                        </PaperButton>
                    </Show>
                </PaperEmptyState>
            }>
                <PaperCard>
                    <PaperFlex direction="column" padding="full" gap="full">
                        <PaperText>Greetings given so far: {state().greetingCount}</PaperText>
                        <PaperInput
                            fullWidth
                            label="Name"
                            value={name()}
                            onInput={(e) => setName(e.currentTarget.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void greet();
                            }}
                        />
                        <PaperFlex direction="row" gap="half" align="center">
                            <PaperButton disabled={busy()} onClick={() => void greet()}>
                                Greet
                            </PaperButton>
                            <Show when={greeting()}>
                                <PaperText>{greeting()}</PaperText>
                            </Show>
                        </PaperFlex>
                    </PaperFlex>
                </PaperCard>
                <Show when={failure()}>
                    <PaperQuote variant="danger" icon="warning" title="Not greeted" role="alert" onDismiss={() => setFailure("")}>
                        {failure()}
                    </PaperQuote>
                </Show>
            </Show>
        </>
    );
}
