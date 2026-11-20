// A computer's info page and the Forget Computer dialog in the real shell:
// a switch that saves to the computer, and forgetting a computer that can't
// be reached.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, clickText, toastShown, type Shell } from "./support/shell";

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
    // read, it is closed: the next test starts with no toast in the corner
    await page.click(`[aria-label=Notifications] [role=alert] [aria-label=Close]`);
    await page.waitFor(`!${toastShown("The setting was not saved")}`, "the toast closed");
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
    await page.waitFor(`[...document.querySelectorAll("[role=dialog] [role=alert]")].some((a) => a.innerText.includes("Shed wasn't told"))`, "the warning that Shed wasn't told");
    expect(await page.evaluate(`!!document.querySelector(${JSON.stringify(SHED)})`)).toBe(true);

    await clickText(page, "[role=dialog] button", "Forget Anyway");
    await page.waitFor(`!document.querySelector(${JSON.stringify(SHED)}) && !document.querySelector("[role=dialog]")`, "Shed gone from the rail");
    expect(page.exceptions).toEqual([]);
});
