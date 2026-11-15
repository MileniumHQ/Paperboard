// An open panel's frame follows the panel's running backups, to cover the
// page while one holds its service. When that connection drops and can't
// come back, the shell says so; once it is back, the notice goes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { API_DEMO, bootShell, type Shell } from "./support/shell";

// The shell's own sockets, held by the test: drop() closes them and sends
// every new one nowhere, as a computer that stopped answering; allow()
// lets the next one through. Panel pages are frames, with sockets of their own.
const SOCKETS = `(() => {
    if (window !== window.top) return;
    const Real = window.WebSocket;
    const open = new Set();
    const gate = { blocked: false };
    gate.drop = () => { gate.blocked = true; for (const socket of open) socket.close(); };
    gate.allow = () => { gate.blocked = false; };
    window.__sockets = gate;
    window.WebSocket = class extends Real {
        constructor(url, protocols) {
            super(gate.blocked ? "ws://127.0.0.1:9/" : url, protocols);
            open.add(this);
            this.addEventListener("close", () => open.delete(this));
        }
    };
})();`;

const ID = "dev.paperboard.apidemo";
const frame = `document.querySelector("iframe[data-panel-key='local::${ID}']")`;
const notice = `[...document.querySelectorAll("[role=region][aria-label=Notifications] [role=status]")].find((t) => t.textContent.includes("Can't follow backups"))`;

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ panels: [API_DEMO], init: SOCKETS });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a panel's backup progress that can't be heard says so, and stops saying so once it can.
test("an open panel whose backup progress connection is lost says so until it reconnects", async () => {
    const { page } = shell;
    await page.click("[role=radio][aria-label='This Computer (127.0.0.1)']");
    await page.waitFor(`document.querySelector("label[data-value='${ID}']")`, "API Demo in the sidebar");
    await page.click(`label[data-value='${ID}']`);
    await page.waitFor(`${frame}?.contentDocument?.readyState === "complete" && ${frame}.contentDocument.location.href !== "about:blank"`, "API Demo's page to load");
    expect(await page.evaluate(`!${notice}`)).toBe(true);

    await page.evaluate(`window.__sockets.drop()`);
    await page.waitFor(notice, "the notice that backups can't be followed");
    const said = await page.evaluate<string>(`${notice}.textContent`);
    expect(said).toContain("This Computer");
    expect(said).toContain("Paperboard keeps trying");

    await page.evaluate(`window.__sockets.allow()`);
    await page.waitFor(`!${notice}`, "the notice gone once it reconnects");
    expect(page.exceptions).toEqual([]);
});
