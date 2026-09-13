import { render } from "solid-js/web";
import { PaperProvider } from "@paperboard-dev/paperui";
import App from "./App";

const root = document.getElementById("app");
if (root) {
    // every panel is its own document: without the provider there is no
    // .paperui-root / [data-paperui-theme] contract, so scoped scrollbars,
    // selection rules, disabled treatment and forced theming all drop out
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <App />
            </PaperProvider>
        ),
        root,
    );
}
