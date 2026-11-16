// Failures that stand are said where they happen, in the shell's own views,
// and never as a toast that goes while the failure stays: a computer's
// panels that couldn't be listed, a Computer Info section that couldn't be
// read, a damaged backup locations file, a location chooser that couldn't
// list, and a computer that still can't be reached.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { API_DEMO, bootShell, clickText, errorGone, errorShown, type Shell } from "./support/shell";

// The daemon refuses the shell's calls of an action while it is broken here:
// each goes out under a name the daemon doesn't know, and comes back with its
// own refusal. Panel pages are frames, with sockets of their own.
const BREAK_CALLS = `(() => {
    if (window !== window.top) return;
    const broken = new Set();
    const refused = {};
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        const message = typeof data === "string" ? JSON.parse(data) : null;
        if (!message || !broken.has(message.action)) return send.call(this, data);
        refused[message.action] = (refused[message.action] ?? 0) + 1;
        send.call(this, JSON.stringify({ ...message, action: message.action + ":refused" }));
    };
    window.__break = (action) => broken.add(action);
    window.__mend = (action) => broken.delete(action);
    window.__refused = (action) => refused[action] ?? 0;
})()`;

let shell: Shell;
let workshop: Awaited<ReturnType<Shell["pairComputer"]>>;
const rail = (label: string) => `[role=radio][aria-label=${JSON.stringify(label)}]`;
const LOCAL = rail("This Computer (127.0.0.1)");
const WORKSHOP = rail("Workshop (127.0.0.2)");
const API_DEMO_ID = "dev.paperboard.apidemo";
const frame = `document.querySelector("iframe[data-panel-key='local::${API_DEMO_ID}']")`;
// presses the button reading `label` in the failure titled so, in the view on screen
const pressIn = async (title: string, label: string) => {
    await shell.page.evaluate(`(() => {
        for (const el of document.querySelectorAll("[data-press]")) delete el.dataset.press;
        const failure = [...document.querySelectorAll("[data-paper-error]")].find((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)} && e.offsetParent !== null);
        [...failure.querySelectorAll("button")].find((b) => b.textContent.includes(${JSON.stringify(label)})).dataset.press = "";
    })()`);
    await shell.page.click("[data-press]");
};

beforeAll(async () => {
    shell = await bootShell({ panels: [API_DEMO], init: BREAK_CALLS });
    workshop = await shell.pairComputer("Workshop");
});

afterAll(async () => {
    await shell?.close();
});

async function openInfo(railItem: string): Promise<void> {
    const { page } = shell;
    await page.click(railItem, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Computer Info']")`, "the computer's menu");
    await page.click("[data-context-item='Computer Info']");
}

// Inventory: Core contracts — a computer's panels that couldn't be listed say so over the list, with Try again, and never only in a toast.
test("a panel list that can't be read stands over the panels it last listed, and Try again lists them", async () => {
    const { page } = shell;
    await page.click(LOCAL);
    const row = `document.querySelector("label[data-value='${API_DEMO_ID}']")`;
    await page.waitFor(row, "API Demo in the sidebar");
    await page.evaluate(`window.__break("panel:list")`);
    // choosing the computer again lists its panels again
    await page.click(rail("Home"));
    await page.click(LOCAL);
    const title = "Couldn't list the panels";
    await page.waitFor(`${errorShown(title, "Unknown action: panel:list:refused", "Try again")} && !!${row}`, "the failure, over the panels already listed");

    // Try again asks again, and a refusal leaves the failure standing
    const asked = await page.evaluate<number>(`window.__refused("panel:list")`);
    await pressIn(title, "Try again");
    await page.waitFor(`window.__refused("panel:list") > ${asked} && ${errorShown(title)}`, "Try again to ask again, and still be refused");
    // the computer lists them once it answers, and the failure goes
    await page.evaluate(`window.__mend("panel:list")`);
    await pressIn(title, "Try again");
    await page.waitFor(`${errorGone(title)} && !!${row}`, "the list, and the failure gone");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a Computer Info section that couldn't be read says so in the section, with Try again.
test("Ports and Backups that can't be read say so in their sections, and Try again reads each", async () => {
    const { page } = shell;
    await page.evaluate(`window.__break("ports:all"); window.__break("backup:destinations")`);
    await openInfo(LOCAL);
    const ports = "Couldn't load ports";
    const locations = "Couldn't load backup locations";
    await page.waitFor(`${errorShown(ports, "Unknown action: ports:all:refused", "Try again")} && ${errorShown(locations, "Unknown action: backup:destinations:refused", "Try again")}`, "both sections to say they couldn't load");
    // the page was read once already, out of view: what it read stays under the failure
    expect(await page.evaluate(`document.body.innerText.includes("No panel holds a port")`)).toBe(true);

    await page.evaluate(`window.__mend("ports:all")`);
    await pressIn(ports, "Try again");
    await page.waitFor(`${errorGone(ports)} && document.body.innerText.includes("No panel holds a port")`, "the ports, and their failure gone");
    // the other section still says its own failure
    expect(await page.evaluate(errorShown(locations))).toBe(true);
    await page.evaluate(`window.__mend("backup:destinations")`);
    await pressIn(locations, "Try again");
    await page.waitFor(`${errorGone(locations)} && document.body.innerText.includes("A panel asks where to keep its backups")`, "the locations, and their failure gone");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Backups — a damaged backup locations file stands in Backups, with why and the way to set it aside.
test("a damaged backup locations file stands in Backups until it is set aside", async () => {
    const { page } = shell;
    const file = path.join(shell.dataDir, "backups", "destinations.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    // Computer Info reads its sections again as it comes back into view
    await page.click(rail("Home"));
    await openInfo(LOCAL);
    const title = "The backup locations file is damaged";
    await page.waitFor(errorShown(title, "Set Aside and Start Fresh"), "the damaged file, said in Backups");
    expect(await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Add Location").disabled`)).toBe(true);
    // set aside, never deleted
    await pressIn(title, "Set Aside and Start Fresh");
    await page.waitFor(errorGone(title), "the failure gone once the file is set aside");
    const kept = fs.readdirSync(path.dirname(file)).map((name) => path.join(path.dirname(file), name)).filter((p) => p !== file && fs.statSync(p).isFile());
    expect(kept.some((p) => fs.readFileSync(p, "utf8") === "{ not json")).toBe(true);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Backups — a location chooser that couldn't list the locations says so in the window, with Try again.
test("the backup location chooser says in the window when it can't list the locations, and Try again lists them", async () => {
    const { page } = shell;
    await page.click(LOCAL);
    await page.click(`label[data-value='${API_DEMO_ID}']`);
    await page.waitFor(`${frame}?.contentDocument?.querySelector("[data-do=choose]")`, "API Demo's page to load");
    await page.evaluate(`window.__break("backup:destinations")`);
    await page.evaluate(`${frame}.contentDocument.querySelector("[data-do=choose]").click()`);
    const title = "Couldn't load backup locations";
    const dialog = `[...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Where should API Demo backups go?"))`;
    await page.waitFor(`${errorShown(title, "Try again")} && !!${dialog}?.querySelector("[data-paper-error]")`, "the failure, in the chooser");
    expect(await page.evaluate(`[...${dialog}.querySelectorAll("button")].find((b) => b.textContent === "Use this location").disabled`)).toBe(true);

    await page.evaluate(`window.__mend("backup:destinations")`);
    await pressIn(title, "Try again");
    await page.waitFor(`${errorGone(title)} && ${dialog}?.innerText.includes("of backups")`, "the locations, and the failure gone");
    await clickText(page, "button", "Cancel");
    await page.waitFor(`!${dialog}`, "the chooser to close");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a reconnect that finds nothing says why over the lost computer, never only in a toast.
// Last: the paired computer stops for good.
test("Attempt Reconnect that finds nothing says why over the lost computer", async () => {
    const { page } = shell;
    await page.click(WORKSHOP);
    await page.waitFor(`document.querySelector(${JSON.stringify(WORKSHOP)})?.getAttribute("aria-checked") === "true"`, "Workshop open");
    await workshop.daemon.stop();
    await page.waitFor(`document.body.innerText.includes("Connection Lost")`, "the computer to be lost");
    await clickText(page, "button", "Attempt Reconnect");
    const title = "Couldn't reach this computer";
    await page.waitFor(`${errorShown(title)} && [...document.querySelectorAll("[data-paper-error][role=alert]")].some((e) => e.getAttribute("aria-label") === ${JSON.stringify(title)})`, "why, over the lost computer");
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Attempt Reconnect") && !b.disabled)`, "Attempt Reconnect to answer");
    expect(page.exceptions).toEqual([]);
});
