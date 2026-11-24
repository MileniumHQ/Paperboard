import { render } from "solid-js/web";
import { PaperProvider } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import Dashboard from "./Dashboard";

render(
    () => (
        <PaperProvider theme="system" styleBody fullWidth fullHeight>
            <Dashboard />
        </PaperProvider>
    ),
    document.getElementById("root")!,
);
