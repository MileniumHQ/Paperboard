import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperProvider } from "@mileniumhq/paperui";
import { errorMessage } from "@mileniumhq/paperapi";
import App from "./App";

const root = document.getElementById("app");
// a page with nothing to render into is broken: say so instead of a blank panel
if (!root) throw new Error('index.html has no element with id "app" to render the panel into');

// every panel is its own document: without the provider there is no
// .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
// selection rules, disabled treatment and forced theming all drop out
render(
    () => (
        <PaperProvider fullWidth fullHeight>
            {/* a screen that can't start says why, instead of leaving the panel blank */}
            <ErrorBoundary
                fallback={(err) => {
                    console.error("[drive] could not start:", err);
                    return (
                        <PaperFlex fullWidth fullHeight align="center" justify="center" padding="double">
                            <PaperEmptyState icon="error" title="Drive could not start" description={errorMessage(err)} role="alert">
                                <PaperButton variant="primary" onClick={() => location.reload()}>
                                    <PaperIcon>refresh</PaperIcon> Reload
                                </PaperButton>
                            </PaperEmptyState>
                        </PaperFlex>
                    );
                }}
            >
                <App />
            </ErrorBoundary>
        </PaperProvider>
    ),
    root,
);
