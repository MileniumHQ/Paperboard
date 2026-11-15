// The shell in its phone layout (bootShell({ phone: true })), as a phone
// that has paired nothing opens: on the welcome, whose Add Computer is the
// way in. Everything waits on what the page does, never on a delay.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, clickText, type Shell } from "./support/shell";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ phone: true });
});

afterAll(async () => {
    await shell?.close();
});

// Inventory: Core contracts — a network discovery that broke says why in Add Computer instead of an empty list.
test("Add Computer: when looking for computers on the network broke, the list says why, in view on a phone", async () => {
    const { page } = shell;
    const WARNING = `document.querySelector("[role=alert]")?.textContent ?? ""`;
    const open = async () => {
        await clickText(page, "button", "Add Computer");
        await page.waitFor(`[...document.querySelectorAll("label")].some((l) => l.textContent.includes("Custom IP"))`, "Add Computer to open");
    };
    const close = async () => {
        await page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        await page.waitFor(`![...document.querySelectorAll("label")].some((l) => l.textContent.includes("Custom IP"))`, "Add Computer to close");
    };

    // a phone that has paired nothing opens on its welcome, not on this computer
    expect(await page.evaluate(`Boolean(document.querySelector("#mobile-welcome-title"))`)).toBe(true);
    expect(await page.evaluate(`Boolean(document.querySelector("[role=radio][aria-label$='(127.0.0.1)']"))`)).toBe(false);

    // the network changes while nothing is open: the mDNS socket fails
    expect(await shell.host({ cmd: "fail-mdns", message: "send EHOSTUNREACH 224.0.0.251:5353" })).toBe(true);
    await open();
    await page.waitFor(`(${WARNING}).includes("Paperboard can't look for computers on this network: send EHOSTUNREACH 224.0.0.251:5353")`, "why nearby computers aren't listed");
    expect(await page.evaluate(`document.body.innerText.includes("Looking for computers on your network")`)).toBe(false);
    // seen as it is on a phone: whole across the screen, and what is drawn at its middle is the warning
    expect(await page.evaluate(`(() => {
        const alert = document.querySelector("[role=alert]");
        const box = alert.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth && alert.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })()`)).toBe(true);
    await close();
    expect(page.exceptions).toEqual([]);
});
