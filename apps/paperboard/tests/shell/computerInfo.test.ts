// A computer's info page and the Forget Computer dialog in the real shell:
// a switch that saves to the computer, and forgetting a computer, failed
// and done, from wherever you are.
import { afterAll, beforeAll, expect, test } from "bun:test";
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
// the switch on the info page in view; every computer keeps its own page
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
