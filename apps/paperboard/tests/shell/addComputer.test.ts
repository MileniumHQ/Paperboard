// Add Computer in an Electron window (ELECTRON_PRELOAD), against real
// daemons opened for pairing by `papercrane pair`: what pair tells a person
// to type is what Add Computer can use, and what goes wrong is said in words
// that fit the dialog.
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
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

// Inventory: Core contracts — papercrane pair and Add Computer agree on a daemon that only listens on loopback.
test("a daemon on loopback: papercrane pair offers no address to type, and Add Computer says in words why it can't pair", async () => {
    const { page } = shell;
    const pairing = await shell.openPairing("127.0.0.1");
    expect(pairing.said()).not.toContain("Custom IP");
    expect(pairing.said()).toContain("Start it with --host 0.0.0.0");

    // typed whole, the address fills both fields
    await typeAddress(`127.0.0.1:${pairing.daemon.port}`);
    await page.waitFor(fieldShown("Server port"), "the port field");
    expect(await page.evaluate(`[document.querySelector(${JSON.stringify(fieldOf("Computer address"))}).value, document.querySelector(${JSON.stringify(fieldOf("Server port"))}).value]`)).toEqual([
        "127.0.0.1",
        String(pairing.daemon.port),
    ]);
    // labelled fields name what goes in them; no example stands in a field
    expect(await page.evaluate(`[...document.querySelectorAll("[role=dialog] input")].map((i) => i.placeholder).filter(Boolean)`)).toEqual([]);
    await page.waitFor(
        `document.querySelector("[role=dialog]").innerText.includes("That server only accepts this computer. Start it with --host 0.0.0.0")`,
        "why the loopback daemon can't pair",
    );
    expect(await page.evaluate(NEXT_ENABLED)).toBe(false);
    await closeWizard();
    expect(page.exceptions).toEqual([]);
});

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

// Inventory: Core contracts — a computer with no panels says where to find some.
test("a paired computer with no panels says to find some in the Panel Library", async () => {
    const { page } = shell;
    await shell.pairComputer("Shed");
    await page.click(`[role=radio][aria-label='Shed (127.0.0.2)']`);
    await page.waitFor(`document.body.innerText.includes("No panels yet. Find some in the Panel Library.")`, "the new computer's empty page");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — an address that answers but isn't a daemon is said in words that fit the dialog.
test("a port that answers without the daemon's encryption is said in words, inside the dialog", async () => {
    const { page } = shell;
    // a plain web server where Paperboard dials a remote daemon over TLS
    const server = http.createServer((_req, res) => res.end("not a daemon"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.2", resolve));
    try {
        await page.resize(860, 560);
        await typeAddress(`127.0.0.2:${(server.address() as AddressInfo).port}`);
        await page.waitFor(
            `document.querySelector("[role=dialog]").innerText.includes("Something other than Paperboard answered there. Check the port")`,
            "the reason the address isn't a daemon",
        );
        const fit = await page.evaluate<{ raw: boolean; overflowing: string[] }>(`(() => {
            const dialog = document.querySelector("[role=dialog]");
            return {
                raw: /SSL|EPROTO|WRONG_VERSION/.test(dialog.innerText),
                overflowing: [dialog, ...dialog.querySelectorAll("*")]
                    .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible")
                    .map((el) => el.className || el.tagName),
            };
        })()`);
        expect(fit).toEqual({ raw: false, overflowing: [] });
        await closeWizard();
    } finally {
        server.close();
    }
    expect(page.exceptions).toEqual([]);
});
