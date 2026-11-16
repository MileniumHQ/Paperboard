// A computer's info page and the Forget Computer dialog in the real shell:
// a switch that saves to the computer, and forgetting a computer, failed
// and done, from wherever you are.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { bootShell, clickText, type Shell } from "./support/shell";

// Holds the shell's calls of one daemon action until the test sends them
// on, as they were or with a parameter the daemon refuses.
const HOLD_CALLS = `(() => {
    const held = [];
    const waiting = [];
    let holding = null;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        const message = JSON.parse(data);
        if (message.action !== holding) return send.call(this, data);
        held.push({ socket: this, message });
        for (const wake of waiting.splice(0)) wake();
    };
    window.__hold = (action) => { holding = action; };
    window.__heldCall = () => new Promise((resolve) => {
        const check = () => (held.length ? resolve(held[0].message.params.policy) : waiting.push(check));
        check();
    });
    window.__sendHeld = (params) => {
        const { socket, message } = held.shift();
        send.call(socket, JSON.stringify({ ...message, params: { ...message.params, ...params } }));
    };
})()`;

let shell: Shell;
const rail = (label: string) => `[role=radio][aria-label=${JSON.stringify(label)}]`;
const LOCAL = rail("This Computer (127.0.0.1)");
// the switch on the info page in view
const PORTS_SWITCH = `[...document.querySelectorAll("[role=switch]")].find((s) => s.offsetParent !== null)`;

beforeAll(async () => {
    shell = await bootShell({ init: HOLD_CALLS });
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

// Inventory: Core contracts — a switch flips at once, saves in order, and falls back with an error.
test("Refuse taken ports flips at once while it saves, and goes back with why when the computer refuses", async () => {
    const { page } = shell;
    await openInfo(LOCAL);
    await page.waitFor(`${PORTS_SWITCH}?.getAttribute("aria-checked") === "false" && document.body.innerText.includes("No panel holds a port")`, "the Ports section, loaded");
    await page.evaluate(`window.__hold("ports:policy-set")`);
    await page.evaluate(`${PORTS_SWITCH}.dataset.target = ""`);

    await page.click("[role=switch][data-target]");
    expect(await page.evaluate(`window.__heldCall()`)).toBe("refuse");
    expect(await page.evaluate(`document.querySelector("[data-target]").getAttribute("aria-checked")`)).toBe("true");
    expect(await page.evaluate(`document.querySelector("[data-target]").getAttribute("aria-disabled")`)).toBe(null);

    // pressed again while the first save is out: it waits its turn, and the
    // computer refuses it
    await page.click("[role=switch][data-target]");
    expect(await page.evaluate(`document.querySelector("[data-target]").getAttribute("aria-checked")`)).toBe("false");
    await page.evaluate(`window.__sendHeld({})`);
    expect(await page.evaluate(`window.__heldCall()`)).toBe("next-free");
    await page.evaluate(`window.__sendHeld({ policy: "every-other-port" })`);
    await page.waitFor(
        `document.querySelector("[data-target]").getAttribute("aria-checked") === "true" && document.body.innerText.includes("The setting was not saved")`,
        "the switch back on what the computer kept, with why",
    );
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — what a backup location holds is read as the page opens, not when the app started.
test("Computer Info counts the backups made since it was last open", async () => {
    const { page } = shell;
    const usage = (text: string) => `[...document.querySelectorAll("p, span")].some((e) => e.offsetParent !== null && e.textContent === ${JSON.stringify(text)})`;
    await openInfo(LOCAL);
    await page.waitFor(`document.body.innerText.includes("0 B of backups")`, "the empty This Computer location");

    // a panel makes a backup into This Computer while the page is closed
    await page.click("[role=radio][aria-label^='Home']");
    await page.waitFor(`!document.body.innerText.includes("of backups")`, "Computer Info left");
    const dir = path.join(shell.dataDir, "backups", "panels", "dev.paperboard.gameserver");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "b-0123456789abcdef.pbbackup"), Buffer.alloc(3 * 1024 * 1024));

    await openInfo(LOCAL);
    await page.waitFor(`document.body.innerText.includes("3 MB of backups")`, "the backup counted");
    expect(await page.evaluate(usage("0 B of backups"))).toBe(false);
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a location that can't be added says why in words, where it is seen.
test("an S3 server that refuses the connection is named in words, in view of the person at the narrowest window", async () => {
    const { page } = shell;
    await page.resize(860, 560);
    await openInfo(LOCAL);
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.textContent.includes("Add Location") && b.offsetParent !== null)`, "the Backups section");
    await clickText(page, "button", "Add Location");
    await page.waitFor(`document.querySelector("[role=dialog] button[aria-haspopup=listbox]")`, "the provider menu");
    await page.click("[role=dialog] button[aria-haspopup=listbox]");
    await page.waitFor(`document.querySelector("[role=option][data-select-value=s3]")?.offsetParent`, "the S3 option");
    // the menu has finished opening: an option pressed while it grows can miss
    await page.evaluate(`Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished))`);
    await page.click("[role=option][data-select-value=s3]");
    await page.waitFor(`[...document.querySelectorAll("[role=dialog] label")].some((l) => l.textContent.trim() === "Server address")`, "the S3 form");
    const fields: Record<string, string> = {
        Name: "Garage bucket",
        "Server address": "http://127.0.0.1:1",
        Region: "us-east-1",
        "Bucket name": "backups",
        "Access key ID": "AKID",
        "Secret access key": "secret",
    };
    for (const [label, value] of Object.entries(fields)) {
        await page.evaluate(`[...document.querySelectorAll("[role=dialog] label")].find((l) => l.textContent.trim() === ${JSON.stringify(label)}).control.dataset.field = ${JSON.stringify(label)}`);
        await page.type(`[data-field=${JSON.stringify(label)}]`, value);
    }
    await clickText(page, "[role=dialog] label", "Self-hosted server");
    await clickText(page, "[role=dialog] button", "Add Bucket");

    const said = "Couldn't reach 127.0.0.1:1. Is the server running?";
    await page.waitFor(`document.querySelector("[role=dialog] [role=alert]")?.textContent === ${JSON.stringify(said)}`, "the refusal, in words");
    // seen as it is: what is drawn at its middle is the error itself, not the form scrolled over it
    expect(await page.evaluate(`(() => {
        const alert = document.querySelector("[role=dialog] [role=alert]");
        const box = alert.getBoundingClientRect();
        return alert.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })()`)).toBe(true);
    await clickText(page, "[role=dialog] button", "Cancel");
    await page.waitFor(`!document.querySelector("[role=dialog]")`, "the window closed");
    await page.send("Emulation.clearDeviceMetricsOverride");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — forgetting a computer says why it failed, once, and leaves you where you are.
test("a failed forget shows why, the dialog opens clean the next time, and forgetting another computer leaves you on yours", async () => {
    const { page } = shell;
    const workshop = await shell.pairComputer("Workshop");
    const garage = await shell.pairComputer("Garage");
    const WORKSHOP = rail("Workshop (127.0.0.2)");
    const GARAGE = rail("Garage (127.0.0.2)");
    expect(workshop.id).not.toBe(garage.id);

    // from Garage's info page, a forget the computer list refuses
    await openInfo(GARAGE);
    await page.waitFor(`document.querySelector(${JSON.stringify(GARAGE)}).getAttribute("aria-checked") === "true"`, "Garage selected");
    await shell.host({ cmd: "fail-remove", message: "The computer list is read-only" });
    await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.offsetParent !== null && b.textContent.includes("Forget Computer"))`, "Garage's Forget Computer button");
    await clickText(page, "button", "Forget Computer");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("forget Garage")`, "the Forget Computer dialog");
    // its title names the computer it forgets
    expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText.split("\\n")[0].trim()`)).toBe("Forget Garage?");
    await clickText(page, "[role=dialog] button", "Forget Computer");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("The computer list is read-only")`, "why the forget failed");
    await clickText(page, "[role=dialog] button", "Cancel");
    await page.waitFor(`!document.querySelector("[role=dialog]")`, "the dialog to close");

    // opened again: a fresh question, not the last answer
    await clickText(page, "button", "Forget Computer");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("forget Garage")`, "the Forget Computer dialog again");
    expect(await page.evaluate(`document.querySelector("[role=dialog]").innerText.includes("read-only")`)).toBe(false);
    await clickText(page, "[role=dialog] button", "Cancel");
    await page.waitFor(`!document.querySelector("[role=dialog]")`, "the dialog to close");

    // Workshop forgotten from the rail while Garage is open: Garage stays open
    await page.click(WORKSHOP, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Forget Computer']")`, "Workshop's menu");
    await page.click("[data-context-item='Forget Computer']");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("forget Workshop")`, "the Forget Computer dialog for Workshop");
    await clickText(page, "[role=dialog] button", "Forget Computer");
    await page.waitFor(`!document.querySelector(${JSON.stringify(WORKSHOP)}) && !document.querySelector("[role=dialog]")`, "Workshop gone from the rail");
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(GARAGE)}).getAttribute("aria-checked")`)).toBe("true");
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(LOCAL)}).getAttribute("aria-checked")`)).toBe("false");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Security — a computer that couldn't be told it's forgotten keeps trusting this one, so forgetting it says so first.
test("forgetting a computer that can't be reached warns that it wasn't told, and forgets it here only when asked again", async () => {
    const { page } = shell;
    const shed = await shell.pairComputer("Shed");
    const SHED = rail("Shed (127.0.0.2)");
    await page.waitFor(`document.querySelector(${JSON.stringify(SHED)})`, "Shed on the rail");
    await shed.daemon.stop();

    await page.click(SHED, "right");
    await page.waitFor(`document.querySelector("[data-context-item='Forget Computer']")`, "Shed's menu");
    await page.click("[data-context-item='Forget Computer']");
    await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("forget Shed")`, "the Forget Computer dialog for Shed");
    await clickText(page, "[role=dialog] button", "Forget Computer");
    await page.waitFor(`document.querySelector("[role=dialog] [role=alert]")?.innerText.includes("Shed wasn't told")`, "the warning that Shed wasn't told");
    expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(SHED)})`)).toBe(true);

    await clickText(page, "[role=dialog] button", "Forget Anyway");
    await page.waitFor(`!document.querySelector(${JSON.stringify(SHED)}) && !document.querySelector("[role=dialog]")`, "Shed gone from the rail");
    expect(page.exceptions).toEqual([]);
});
