// The demo's own panel page: enough to be a panel the widgets can open.
import "@mileniumhq/paperui/style.css";
import "./style.css";
import { serviceClient } from "@mileniumhq/paperapi";
import { demoContract } from "./contract";

const client = serviceClient(demoContract);
const app = document.getElementById("app")!;
app.className = "demo-panel";
app.innerHTML = `<h1>Widget Demo</h1><p>This panel exists to test Home widgets. Add its widgets from Home → Edit Home.</p><p class="big" aria-live="polite"></p><button type="button">Add one</button>`;
const count = app.querySelector<HTMLParagraphElement>(".big")!;
const show = () => { count.textContent = `Count: ${client.state.current().count}`; };
client.state.subscribe(show);
show();
app.querySelector("button")!.addEventListener("click", () => {
    client.calls.increment({}).catch((err) => { count.textContent = `Couldn't count: ${err instanceof Error ? err.message : String(err)}`; });
});
