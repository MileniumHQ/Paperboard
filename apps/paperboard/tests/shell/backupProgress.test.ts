// An open panel's frame follows the panel's running backups, to cover the
// page while one holds its service. When that connection drops and can't
// come back, the frame says so over its page, never in a toast; once it is
// back, the failure goes.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { API_DEMO, bootShell, errorGone, errorShown, type Shell } from "./support/shell";

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
const LOST = "Couldn't follow backups";
// the failure stands in the panel's own frame, not somewhere else in the window
const inFrame = `[...(document.querySelector("[data-panel-key='local::${ID}']")?.parentElement?.querySelectorAll("[data-paper-error]") ?? [])].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(LOST)})`;

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
    expect(await page.evaluate(errorGone(LOST))).toBe(true);

    await page.evaluate(`window.__sockets.drop()`);
    await page.waitFor(`${errorShown(LOST, "This Computer", "Paperboard keeps trying")} && ${inFrame}`, "the frame to say backups can't be followed");

    await page.evaluate(`window.__sockets.allow()`);
    await page.waitFor(errorGone(LOST), "the failure gone once it reconnects");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Backups — the location chooser says whose backups it places, and where each location is apart from how full it is.
test("the backup location chooser names the panel, and puts a location's place and its totals on lines of their own", async () => {
    const { page } = shell;
    await page.evaluate(`${frame}.contentDocument.querySelector("[data-do=choose]").click()`);
    const dialog = `document.querySelector("[role=dialog]")`;
    await page.waitFor(`${dialog}?.innerText.includes("of backups")`, "the chooser, with each location's totals");
    const lines = await page.evaluate<string[]>(`${dialog}.innerText.split("\\n").map((l) => l.trim()).filter(Boolean)`);
    expect(lines[0]).toBe("Where should API Demo backups go?");
    // the folder is a line of its own, and so are its totals
    expect(lines.some((l) => l.includes("/backups") && !l.includes("of backups"))).toBe(true);
    expect(lines.some((l) => /^[\d.]+ \w+ of backups, /.test(l))).toBe(true);
    await page.evaluate(`[...${dialog}.querySelectorAll("button")].find((b) => b.textContent.includes("Cancel")).click()`);
    await page.waitFor(`!${dialog}`, "the chooser to close");
    expect(page.exceptions).toEqual([]);
});
