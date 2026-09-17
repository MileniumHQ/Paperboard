import "@paperboard-dev/paperui/style.css";
import "./shell.css";

import { render } from "solid-js/web";
import App from "./App";
import { configureHostConnection, initPaperApi } from "@paperboard-dev/paperapi";

async function startShell() {
    const close = configureHostConnection(() => window.electron!.ipcRenderer!.invoke<{ port: number; token: string }>("crane-credentials"));
    window.addEventListener("pagehide", close, { once: true });
    await initPaperApi({ computerId: "local" });
    render(() => <App />, document.getElementById("root") as HTMLElement);
}
void startShell().catch((err) => {
    console.error("[shell] daemon connection failed:", err);
    const root = document.getElementById("root")!;
    root.textContent = "Paperboard could not connect to its local server. ";
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.onclick = () => location.reload();
    root.append(retry);
});
