// Home widget: how many greetings the service has given. A widget is its own
// small page: it mirrors the service's state through its client and says so
// when the service does not answer, in the tile where the number would be.
import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PaperButton, PaperProvider, PaperWidget, PaperWidgetMessage, PaperWidgetStat } from "@mileniumhq/paperui";
import { defineWidgets, serviceClient, type WidgetContext, errorMessage } from "@mileniumhq/paperapi";
import "@mileniumhq/paperui/style.css";
import "./widget.css";
import { panelContract } from "./panel";

function Greetings(props: { widget: WidgetContext }) {
    const service = serviceClient(panelContract);
    const [count, setCount] = createSignal<number | null>(null);
    const [failure, setFailure] = createSignal("");

    const off = service.state.subscribe((full) => setCount(full.greetingCount));
    onCleanup(() => {
        off();
        service.state.dispose();
    });

    const load = async () => {
        setFailure("");
        try {
            setCount((await service.state.refresh()).greetingCount);
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
