// The first meeting and the chat are one app: the agent's head is the same
// face in both (the hologram sphere at the chat's size), and the brain
// choices' logos sit in the middle of their two lines of text.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, type BootedPanel } from "./support/panel";

setDefaultTimeout(120_000);

let panel: BootedPanel | null = null;
afterEach(async () => {
    await panel?.close();
    panel = null;
});

/** the agent's face: its size and whether it is drawn as the hologram */
const HEAD = `(() => { const svg = document.querySelector('svg[role=img][aria-label^="Agent"]'); const r = svg.getBoundingClientRect(); return { width: r.width, height: r.height, hologram: svg.querySelector('[class*=hologram]') !== null }; })()`;

describe("the agent's head", () => {
    test("is the chat's face in the first meeting too", async () => {
        panel = await bootPanel({ settings: { name: "Ada", harness: "codex", model: null, compaction: "summarize" } });
        const chat = await panel.open();
        await chat.waitFor(`document.querySelector('[aria-label="Ada: computer and settings"]')`, "the chat");
        const inChat = await chat.evaluate<{ width: number; height: number; hologram: boolean }>(HEAD);
        await panel.close();

        panel = await bootPanel({ codexOnPath: { signedIn: true, chosen: true } });
        const page = await panel.open();
        await page.waitFor(`document.querySelector('svg[role=img][aria-label^="Agent"]')`, "the first meeting");
        await page.motionSettled();
        expect(inChat.hologram).toBe(true);
        expect(await page.evaluate(HEAD)).toEqual(inChat);
    });

    test("the brain choices' logos are centered against their text", async () => {
        panel = await bootPanel({ codexOnPath: { signedIn: true, chosen: true } });
        const page = await panel.open();
        await page.waitFor(`[...document.querySelectorAll("label")].some((l) => l.textContent.trim() === "Name")`, "the name step");
        await page.evaluate(`[...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Name").control.dataset.testField = "name"`);
        await page.type(`[data-test-field="name"]`, "Ada");
        await page.waitFor(`document.querySelector('form button[type=submit]') && !document.querySelector('form button[type=submit]').disabled`, "Next");
        await page.motionSettled();
        await page.click("form button[type=submit]");
        await page.waitFor(`document.querySelector('input[name="harness"]')`, "the brain choices");
        await page.motionSettled();
        const offsets = await page.evaluate<number[]>(`[...document.querySelectorAll("label")].filter((l) => l.querySelector('input[name=harness]')).map((label) => {
            const icon = (label.querySelector("[class*=iconImage]") ?? label.querySelector("[class*=itemIcon]")).getBoundingClientRect();
            const text = label.querySelector("[class*=itemText]").getBoundingClientRect();
            return icon.top + icon.height / 2 - (text.top + text.height / 2);
        })`);
        expect(offsets).toHaveLength(3);
        for (const offset of offsets) expect(Math.abs(offset)).toBeLessThan(1);
    });
});
