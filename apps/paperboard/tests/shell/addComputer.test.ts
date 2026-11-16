// Add Computer in an Electron window (ELECTRON_PRELOAD), against real
// daemons opened for pairing by `papercrane pair`: what pair tells a person
// to type works, and what goes wrong is said in words that fit the dialog.
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

// Inventory: Core contracts — a computer paired the way `papercrane pair` says is paired, and reached.
test("Add Computer pairs a daemon on loopback when you type what papercrane pair prints", async () => {
    const { page } = shell;
    const pairing = await shell.openPairing("127.0.0.1");
    const advice = /choose Custom IP and type (\S+?)\. Then/.exec(pairing.said())?.[1];
    expect(advice).toBe(`127.0.0.1:${pairing.daemon.port}`);

    await typeAddress(advice!);
    await page.waitFor(NEXT_ENABLED, "the loopback daemon to be reachable");
    await clickText(page, "button", "Next");
    await page.waitFor(fieldShown("Pairing code"), "the pairing step");
    await page.type(fieldOf("Pairing code"), pairing.code);
    expect(await page.evaluate(`document.querySelector(${JSON.stringify(fieldOf("Pairing code"))}).value`)).toBe(
        `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`,
    );
    await clickText(page, "button", "Add Computer");
    expect(await pairing.done).toBe(0);

    // the paired daemon is dialed where it listens, and connects
    const connected = () =>
        page.evaluate<boolean>(
            `fetch("/_shell/invoke/computers-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
                .then((r) => r.json())
                .then((b) => b.result.computers.some((c) => c.id !== "local" && c.port === ${pairing.daemon.port} && c.status.connected))`,
        );
    const deadline = Date.now() + 20_000;
    while (!(await connected())) {
        if (Date.now() > deadline) throw new Error("The paired loopback daemon never connected");
        await Bun.sleep(100);
    }
    await page.waitFor(`document.querySelectorAll("[role=radio][aria-label$='(127.0.0.1)']").length === 2`, "the paired computer in the rail");
    expect(page.exceptions).toEqual([]);
});

// Inventory: Core contracts — a refusal from main is said in its own words, never Electron's wrapping.
test("a wrong pairing code says so in words, without Electron's wrapping", async () => {
    const { page } = shell;
    const pairing = await shell.openPairing("127.0.0.2");
    await typeAddress(`127.0.0.2:${pairing.daemon.port}`);
    await page.waitFor(NEXT_ENABLED, "the daemon to be reachable");
    await clickText(page, "button", "Next");
    await page.waitFor(fieldShown("Pairing code"), "the pairing step");
    const wrong = `${(Number(pairing.code[0]) + 1) % 10}${pairing.code.slice(1)}`;
    await page.type(fieldOf("Pairing code"), wrong);
    await clickText(page, "button", "Add Computer");
    await page.waitFor(`document.querySelector("[role=dialog]").innerText.includes("That code didn't match. Try again in 5 seconds.")`, "the wrong code's reason");
    expect(await page.evaluate(`document.querySelector("[role=dialog]").innerText.includes("Error invoking remote method")`)).toBe(false);
    await closeWizard();
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
            `document.querySelector("[role=dialog]").innerText.includes("Something answered on that port, but not the way the Paperboard server daemon does.")`,
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
