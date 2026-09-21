/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import App from "./App";
import { firstPageFor, resolveRoute } from "./utils/routeUtils";
import { withBase } from "./utils/base";

// Full-document navigation, no router. A bare section path ("/paperui") has no
// page of its own, so replace it with its first page before the app boots.
const route = resolveRoute();
if (route.kind === "section") {
    const first = firstPageFor(route.section!);
    if (first) {
        window.location.replace(withBase(`/${route.section}/${first.pageKey}`));
    }
}

const root = document.getElementById("root");

render(() => <App />, root!);
