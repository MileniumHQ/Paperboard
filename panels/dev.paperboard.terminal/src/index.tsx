import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { PaperButton, PaperEmptyState, PaperFlex, PaperIcon, PaperProvider } from "@mileniumhq/paperui";
import App from "./App";
import { errorMessage } from "./lib/failure";

const root = document.getElementById("app");

if (root) {
    // every panel is its own document: without the provider there is no
    // .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
    // selection rules, disabled treatment and forced theming all drop out
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                {/* a screen that can't start says why, instead of leaving the panel blank */}
                <ErrorBoundary
                    fallback={(err) => {
                        console.error("[terminal] could not start:", err);
                        return (
                            <PaperFlex fullWidth fullHeight align="center" justify="center" padding="double">
                                <PaperEmptyState icon="error" title="The terminal could not start" description={errorMessage(err)} role="alert">
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
}
