import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperEmptyState, PaperProvider } from "@mileniumhq/paperui";
import App from "./App";

// The canvas needs a computer's screen. On a phone the panel says so
// instead of drawing a canvas that can't be used; the flows keep running
// in the service, and the widgets on Home work everywhere.
const ActionsPage = () => {
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [narrow, setNarrow] = createSignal(query.matches);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return (
        <Show
            when={!narrow()}
            fallback={
                <div class="actions-unsupported">
                    <PaperEmptyState
                        icon="phonelink_off"
                        title="Actions isn't on phones yet"
                        description="Open Actions on a computer to build and edit flows. Your flows keep running, and the Actions widgets work on Home."
                    />
                </div>
            }
        >
            <App />
        </Show>
    );
};

const root = document.getElementById("app");
if (root) {
    // every panel is its own document: without the provider there is no
    // .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
    // selection rules, disabled treatment and forced theming all drop out
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <ActionsPage />
            </PaperProvider>
        ),
        root,
    );
}
