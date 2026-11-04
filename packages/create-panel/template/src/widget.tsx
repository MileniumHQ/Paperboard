// Home widget: how many greetings the service has given. A widget is its own
// small page: it mirrors the service's state through the bridge and says so
// when the service does not answer, in the tile where the number would be.
import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PaperButton, PaperProvider, PaperWidget, PaperWidgetMessage, PaperWidgetStat } from "@mileniumhq/paperui";
import { createPanelBridge, defineWidgets, type WidgetContext } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";
import "./widget.css";
import { DEFAULT_STATE, PANEL_ID, type PanelState } from "./panel";
import { errorMessage } from "./lib/failure";

function Greetings(props: { widget: WidgetContext }) {
    const bridge = createPanelBridge<PanelState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });
    const [count, setCount] = createSignal<number | null>(null);
    const [failure, setFailure] = createSignal("");

    const off = bridge.onStateChange((_patch, full) => setCount(full.greetingCount));
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const load = async () => {
        setFailure("");
        try {
            setCount((await bridge.refreshState()).greetingCount);
        } catch (err) {
            setFailure(errorMessage(err));
        }
    };
    void load();

    return (
        <PaperWidget title="Greetings" icon="waving_hand" onPress={() => props.widget.openPanel()} pressLabel="Open the panel">
            <Show
                when={!failure()}
                fallback={
                    <PaperWidgetMessage title="Service not answering" tone="danger" hint={failure()}>
                        <PaperButton size="tiny" onClick={() => void load()}>
                            Retry
                        </PaperButton>
                    </PaperWidgetMessage>
                }
            >
                <Show when={count() !== null} fallback={<PaperWidgetMessage title="Loading" />}>
                    <PaperWidgetStat value={count()!} caption="greetings" aria-live="polite" />
                </Show>
            </Show>
        </PaperWidget>
    );
}

defineWidgets({
    greetings: (root, widget) =>
        render(
            () => (
                <PaperProvider fullWidth fullHeight>
                    <Greetings widget={widget} />
                </PaperProvider>
            ),
            root,
        ),
});
