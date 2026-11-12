import { render } from "solid-js/web";
import { createSignal, onCleanup, Show } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperEmptyState, PaperFlex, PaperProvider } from "@mileniumhq/paperui";
import App from "./App";

// The workspace needs a computer's screen. On a phone the panel says so
// instead of drawing an editor that can't be used; the flows keep running
// in the service.
const BlocksPage = () => {
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [narrow, setNarrow] = createSignal(query.matches);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return (
        <Show when={!narrow()} fallback={
            <PaperFlex fullWidth fullHeight align="center" justify="center" padding="double">
                <PaperEmptyState
                    icon="phonelink_off"
                    title="Blocks isn't on phones yet"
                    description="Open Blocks on a computer to build and edit flows. Your flows keep running."
                />
            </PaperFlex>
        }>
            <App />
        </Show>
    );
};

const root = document.getElementById("app");
// a page with nothing to render into is broken: say so instead of a blank panel
if (!root) throw new Error('index.html has no element with id "app" to render the panel into');

// every panel is its own document: without the provider there is no
// .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
// selection rules, disabled treatment and forced theming all drop out
render(
    () => (
        <PaperProvider fullWidth fullHeight>
            <BlocksPage />
        </PaperProvider>
    ),
    root,
);
