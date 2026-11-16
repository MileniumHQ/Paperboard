import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { PaperButton, PaperEmptyState, PaperProvider, showError } from "@mileniumhq/paperui";
import App from "./App";
import { errorMessage } from "./lib/failure";

const root = document.getElementById("app");
if (!root) throw new Error("The Game Server page has no #app element to render into");

// every panel is its own document: without the provider there is no
// .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
// selection rules, disabled treatment and forced theming all drop out
render(
    () => (
        <PaperProvider fullWidth fullHeight>
            {/* a page that can't start says why, instead of standing blank */}
            <ErrorBoundary
                fallback={(err, reset) => {
                    console.error("[gameserver] could not start:", err);
                    showError("Couldn't start Game Server", errorMessage(err));
                    return (
                        <PaperEmptyState icon="error" title="Couldn't load">
                            <PaperButton onClick={reset}>Try again</PaperButton>
                        </PaperEmptyState>
                    );
                }}
            >
                <App />
            </ErrorBoundary>
        </PaperProvider>
    ),
    root,
);
