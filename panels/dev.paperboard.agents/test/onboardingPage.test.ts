// The first meeting in a real browser over the real service
// (test/support/panel.ts), with Codex on the computer as the fake brain:
// what is answered is what gets saved, and the chat takes over only once it
// is: a save the service can't make keeps the meeting open, with why and a
// way to finish it. The speech plays at its own pace; each step waits for
// its Next button.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL } from "../src/contract";
import { PANEL_ID, bootPanel, settledMotion, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(120_000);

const MODELS = { models: { stdout: JSON.stringify({ models: [{ slug: "gpt-x", display_name: "GPT X", visibility: "list", priority: 1 }] }) } };
const SAVED = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };

let panel: BootedPanel | null = null;
afterEach(async () => {
    await panel?.close();
    panel = null;
});

const NEXT = `document.querySelector('form button[type=submit]')`;
const CHAT = `document.querySelector('[aria-label="Ada: computer and settings"]')`;
const SAVE_ERROR = `[...document.querySelectorAll('[role=alert]')].find((a) => a.innerText.includes("Settings not saved"))`;

/** Waits for the step's way forward to open, and takes it. */
async function next(page: Page, what: string) {
    await page.waitFor(`${NEXT} && !${NEXT}.disabled`, what);
    await settledMotion(page);
    await page.click("form button[type=submit]");
}

/** Chooses `value` in the selector called `name`, once the step shows it. */
async function choose(page: Page, name: string, value: string) {
    const item = `input[name="${name}"][value="${value}"]`;
    await page.waitFor(`document.querySelector('${item}')`, `the ${name} choices`);
    await settledMotion(page);
    await page.click(item);
    await page.waitFor(`document.querySelector('${item}').checked`, `${value} chosen`);
}

/** From a fresh window to the last step, answering: Ada, Codex (already signed in), its default model, no computer yet. */
async function answerAll(page: Page) {
    await page.waitFor(`document.querySelector('input[placeholder="Name"]')`, "the name step");
    await page.type('input[placeholder="Name"]', "Ada");
    await next(page, "the name step's Next");
    await choose(page, "harness", "codex");
    await next(page, "the brain step's Next");
    await next(page, "Codex ready");
    await choose(page, "model", DEFAULT_MODEL);
    await next(page, "the model step's Next");
    await choose(page, "computer", "later");
    await next(page, "the computer step's Next");
    await page.waitFor(`${NEXT}?.innerText.includes("Let's chat")`, "the last step");
}

describe("the first meeting", () => {
    test("saves what was answered, and the chat takes over only once it's saved: a refused save says why and stays", async () => {
        panel = await bootPanel({ codexOnPath: { signedIn: true, chosen: true, plan: MODELS } });
        const page = await panel.open();
        // where the settings go is taken by a folder, so the daemon can't write them
        const blocked = path.join(panel.storage, "..", "..", "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.join(blocked, "taken"), { recursive: true });
        try {
            await answerAll(page);
            await next(page, "Let's chat");
            await page.waitFor(SAVE_ERROR, "the save's refusal");
            await page.settled();
            // still the meeting, with its way to finish
            expect(await page.evaluate(`Boolean(${CHAT})`)).toBe(false);
            expect(await page.evaluate(`${NEXT}.innerText`)).toContain("Let's chat");
        } finally {
            fs.rmSync(blocked, { recursive: true, force: true });
        }
        await next(page, "Let's chat, again");
        await panel.settingsSaved(SAVED);
        await page.waitFor(CHAT, "the chat");
        expect(await page.evaluate(`Boolean(${SAVE_ERROR})`)).toBe(false);
        expect(page.exceptions).toEqual([]);
    });
});
