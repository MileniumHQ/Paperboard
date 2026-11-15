import "@mileniumhq/paperui/style.css";
import "./shell.css";

import { render } from "solid-js/web";
import App from "./App";
import { configureHostConnection, initPaperApi } from "@mileniumhq/paperapi";
import { PaperButton, PaperEmptyState, PaperFlex, PaperProvider } from "@mileniumhq/paperui";
import { logToMain, shellIpc } from "./lib/shell";
import { errorMessage } from "./lib/errorMessage";

async function startShell() {
    const close = configureHostConnection(() => shellIpc().invoke<{ port: number; token: string }>("crane-credentials"));
    window.addEventListener("pagehide", close, { once: true });
    await initPaperApi({ computerId: "local" });
    render(() => <App />, document.getElementById("root") as HTMLElement);
}
// drawn with PaperUI, which needs no server, so it follows the system theme
function NoServer(props: { message: string }) {
    return (
        <PaperProvider fullScreen>
            <PaperFlex center fullWidth fullHeight padding="double" role="alert">
                <PaperEmptyState
                    icon="error"
                    title="No local server"
                    description={`Paperboard could not connect to its local server: ${props.message}`}
                >
                    <PaperButton variant="primary" onClick={() => location.reload()}>Retry</PaperButton>
                </PaperEmptyState>
            </PaperFlex>
        </PaperProvider>
    );
}

void startShell().catch((err) => {
    logToMain("error", "The shell couldn't connect to its local server:", err);
    const root = document.getElementById("root")!;
    root.replaceChildren();
    const message = errorMessage(err);
    render(() => <NoServer message={message} />, root);
});
