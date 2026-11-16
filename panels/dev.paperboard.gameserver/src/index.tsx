import { ErrorBoundary } from "solid-js";
import { render } from "solid-js/web";
import { PaperError, PaperProvider } from "@mileniumhq/paperui";
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
                    return <PaperError fill title="Couldn't start Game Server" error={errorMessage(err)} action={{ label: "Try again", onClick: reset }} />;
                }}
            >
                <App />
            </ErrorBoundary>
        </PaperProvider>
    ),
    root,
);
