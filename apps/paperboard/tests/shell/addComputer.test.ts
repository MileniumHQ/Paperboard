// Add Computer in an Electron window (ELECTRON_PRELOAD), against real
// daemons opened for pairing by `papercrane pair`: what pair tells a person
// to type is what Add Computer can use.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bootShell, clickText, fieldOf, fieldShown, type Shell } from "./support/shell";
import { ELECTRON_PRELOAD } from "./support/electronPreload";

let shell: Shell;

beforeAll(async () => {
    shell = await bootShell({ init: ELECTRON_PRELOAD });
});

afterAll(async () => {
    await shell?.close();
});

const NEXT_ENABLED = `![...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Next")).pop().disabled`;

/** Add Computer, Custom IP, and `address` typed into the address field as one */
async function typeAddress(address: string): Promise<void> {
    const { page } = shell;
    await page.click(`[role=button][aria-label='Add Computer'], button[aria-label='Add Computer']`);
    await clickText(page, "label", "Custom IP");
    await clickText(page, "button", "Next");
    await page.waitFor(fieldShown("Computer address"), "the address step");
    await page.type(fieldOf("Computer address"), address);
}

async function closeWizard(): Promise<void> {
    await shell.page.evaluate(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await shell.page.waitFor(`!document.querySelector("[role=dialog]")`, "Add Computer to close");
}

// Inventory: Core contracts — a refusal from main is said in its own words, never Electron's wrapping.
test("a wrong pairing code at the address papercrane pair prints says so in words, without Electron's wrapping", async () => {
    const { page } = shell;
    const pairing = await shell.openPairing("127.0.0.2");
    const advice = /choose Custom IP and type (\S+?)\. Then/.exec(pairing.said())?.[1];
    expect(advice).toBe(`127.0.0.2:${pairing.daemon.port}`);
    await typeAddress(advice!);
    await page.waitFor(NEXT_ENABLED, "the daemon to be reachable");
    await clickText(page, "button", "Next");
    await page.waitFor(fieldShown("Pairing code"), "the pairing step");
    const wrong = `${(Number(pairing.code[0]) + 1) % 10}${pairing.code.slice(1)}`;
    await page.type(fieldOf("Pairing code"), wrong);
    // grouped as the daemon prints it
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(fieldOf("Pairing code"))}).value`)).toBe(`${wrong.slice(0, 3)} ${wrong.slice(3)}`);
    await clickText(page, "button", "Add Computer");
    await page.waitFor(`document.querySelector("[role=dialog]").innerText.includes("That code didn't match. Try again in 5 seconds.")`, "the wrong code's reason");
    expect(await page.evaluate(`document.querySelector("[role=dialog]").innerText.includes("Error invoking remote method")`)).toBe(false);
    await closeWizard();
    expect(page.exceptions).toEqual([]);
});
