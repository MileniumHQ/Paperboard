import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import App from "./App";
import Main from "./Main";

const root = document.getElementById("app");

// ?face opens the face playground (a dev tool); otherwise the agent
const Page = new URLSearchParams(location.search).has("face") ? App : Main;

if (root) {
    render(
        () => (
            <PaperProvider fullWidth fullHeight>
                <Page />
            </PaperProvider>
        ),
        root,
    );
}
