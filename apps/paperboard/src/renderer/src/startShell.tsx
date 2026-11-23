import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { configureHostConnection, initPaperApi, errorMessage } from "@mileniumhq/paperapi";
import { PaperButton, PaperEmptyState, PaperFlex, PaperProvider } from "@mileniumhq/paperui";
import { logToMain, shellIpc } from "./lib/shell";

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

// Connects the shell to its host's daemon, then draws `view`. Every shell
// starts here: the desktop app's window (main.tsx) and any host that places
// App differently.
export function startShell(view: () => JSX.Element): void {
    const boot = async () => {
        const close = configureHostConnection(() => shellIpc().invoke("crane-credentials"));
        // the page goes away: its views stop following first, so none of them
        // reports a read that failed only because the connections closed under it
        let dispose: (() => void) | null = null;
        window.addEventListener("pagehide", () => {
            dispose?.();
            close();
        }, { once: true });
        await initPaperApi({ computerId: "local" });
        dispose = render(view, document.getElementById("root") as HTMLElement);
    };
    void boot().catch((err) => {
        logToMain("error", "The shell couldn't connect to its local server:", err);
        const root = document.getElementById("root")!;
        root.replaceChildren();
        const message = errorMessage(err);
        render(() => <NoServer message={message} />, root);
    });
}
