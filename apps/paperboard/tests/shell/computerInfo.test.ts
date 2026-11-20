// A computer's info page in the real shell: a switch that saves to the
// computer.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, toastShown, type Shell } from "./support/shell";

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
