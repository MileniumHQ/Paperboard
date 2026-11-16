// A computer lists its panels in whatever order its disk keeps them; the
// sidebar lists them by name, so every computer shows the same order.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { API_DEMO, bootShell, WIDGET_DEMO, type Shell } from "./support/shell";

// Every panel list the daemon answers reaches the shell backwards by name:
// the order a disk that keeps them otherwise could give.
const BACKWARDS = `(() => {
    if (window !== window.top) return;
    const lists = new Set();
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        const message = JSON.parse(data);
        if (message.action === "panel:list") lists.add(message.id);
        return send.call(this, data);
    };
    const listen = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function (type, listener, options) {
        if (type !== "message") return listen.call(this, type, listener, options);
        return listen.call(this, type, (event) => {
            const frame = typeof event.data === "string" ? JSON.parse(event.data) : null;
            if (!frame || frame.type !== "response" || !lists.has(frame.id) || !frame.result?.panels) return listener.call(this, event);
            frame.result.panels.sort((a, b) => b.name.localeCompare(a.name));
            return listener.call(this, new MessageEvent("message", { data: JSON.stringify(frame) }));
        }, options);
    };
})()`;

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ panels: [WIDGET_DEMO, API_DEMO], init: BACKWARDS });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Panels — the sidebar lists a computer's panels by name, whatever order the computer gives them in.
test("the sidebar lists a computer's panels by name, whatever order the computer answers in", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    const rows = `[...document.querySelectorAll("label[data-value^='dev.paperboard.']")].map((l) => l.dataset.value)`;
    await page.waitFor(`${rows}.length === 2`, "both panels in the sidebar");
    expect(await page.evaluate<string[]>(rows)).toEqual(["dev.paperboard.apidemo", "dev.paperboard.widgetdemo"]);
    expect(page.exceptions).toEqual([]);
});
