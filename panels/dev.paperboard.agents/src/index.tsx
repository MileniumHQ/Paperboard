import { lazy } from "solid-js";
import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Main from "./Main";

// ?face opens the face playground, a dev tool: under `vite` only, a release build leaves it out
const Page = import.meta.env.DEV && new URLSearchParams(location.search).has("face") ? lazy(() => import("./App")) : Main;

const root = document.getElementById("app");
if (!root) throw new Error("The page has no #app to draw the panel in");
render(
    () => (
        <PaperProvider fullWidth fullHeight>
            <Page />
        </PaperProvider>
    ),
    root,
);
