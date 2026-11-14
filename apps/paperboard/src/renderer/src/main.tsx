import "@mileniumhq/paperui/style.css";
import "./shell.css";

import { render } from "solid-js/web";
import App from "./App";
import { configureHostConnection, initPaperApi } from "@mileniumhq/paperapi";
import { logToMain, shellIpc } from "./lib/shell";
import { errorMessage } from "./lib/errorMessage";

async function startShell() {
    const close = configureHostConnection(() => shellIpc().invoke<{ port: number; token: string }>("crane-credentials"));
    window.addEventListener("pagehide", close, { once: true });
    await initPaperApi({ computerId: "local" });
    render(() => <App />, document.getElementById("root") as HTMLElement);
}
void startShell().catch((err) => {
    logToMain("error", "The shell couldn't connect to its local server:", err);
    const root = document.getElementById("root")!;
    root.textContent = `Paperboard could not connect to its local server: ${errorMessage(err)} `;
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.onclick = () => location.reload();
    root.append(retry);
});
