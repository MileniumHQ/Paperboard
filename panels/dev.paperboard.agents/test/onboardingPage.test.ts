// The first meeting in a real browser over the real service
// (test/support/panel.ts), with Codex on the computer as the fake brain:
// what is answered is what gets saved, and the chat takes over only once it
// is: a save the service can't make keeps the meeting open, with why and a
// way to finish it. The window asks for reduced motion, as a person can, so
// the speech is there at once instead of typed out; each step still waits
// for its Next button.
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
const SAVE_ERROR = `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].find((a) => a.innerText.includes("Couldn't save the settings"))`;

// the name step's field, found by its label and marked to be typed in
const NAME = `[data-test-field="name"]`;
const NAME_SHOWN = `(() => { const input = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Name")?.control; if (input) input.dataset.testField = "name"; return Boolean(input); })()`;

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
    await page.waitFor(NAME_SHOWN, "the name step");
    await page.type(NAME, "Ada");
    await next(page, "the name step's Next");
    // with reduced motion every line is up at once, the first one too
    const said = await page.evaluate<string>(`document.querySelector('[aria-live="polite"]').innerText`);
    expect(said).toContain("Ada it is!");
    expect(said).toContain("Pick one and I'll download it.");
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
        // asked for before the page starts, so its first words aren't paced either
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        await page.navigate(await page.evaluate<string>("location.href"));
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
        // the toast doesn't cover Finish, so it doesn't repeat it: Finish itself is the way to try again
        expect(await page.evaluate(`Boolean(${SAVE_ERROR}.querySelector('button:not([aria-label="Close"])'))`)).toBe(false);
        await next(page, "Finish, still there to try again");
        await panel.settingsSaved(SAVED);
        await page.waitFor(CHAT, "the chat");
        expect(await page.evaluate(`Boolean(${SAVE_ERROR})`)).toBe(false);
        expect(page.exceptions).toEqual([]);
    });

    test("left part way, it's picked up at the same step with the same answers", async () => {
        panel = await bootPanel({ codexOnPath: { signedIn: true, chosen: true, plan: MODELS } });
        const page = await panel.open();
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        const url = await page.evaluate<string>("location.href");
        await page.navigate(url);
        await page.waitFor(NAME_SHOWN, "the name step");
        await page.type(NAME, "Quill");
        await next(page, "the name step's Next");
        await choose(page, "harness", "codex");
        // the panel is left, and opened again
        await page.settled();
        await page.navigate(url);
        await page.waitFor(`document.querySelector('input[name="harness"][value="codex"]')?.checked`, "the brain step, Codex still chosen");
        expect(await page.evaluate<string>(`document.querySelector('[aria-live="polite"]').innerText`)).toContain("Quill it is!");
        expect(await page.evaluate(NAME_SHOWN)).toBe(false);

        // and it goes on from there to the end, saving what was kept
        await next(page, "the brain step's Next");
        await next(page, "Codex ready");
        await choose(page, "model", DEFAULT_MODEL);
        await next(page, "the model step's Next");
        await choose(page, "computer", "later");
        await next(page, "the computer step's Next");
        await next(page, "Let's chat");
        await panel.settingsSaved({ ...SAVED, name: "Quill" });
        await page.waitFor(`document.querySelector('[aria-label="Quill: computer and settings"]')`, "the chat");
        expect(page.exceptions).toEqual([]);
    });

    // the speech is typed out over seconds: the way forward is there all along, waiting, not sliding in after it
    test("the footer is in view from the first words with Next waiting, and the name field says its name once", async () => {
        panel = await bootPanel({ codexOnPath: { signedIn: true, chosen: true, plan: MODELS } });
        const page = await panel.open();
        await page.waitFor(`document.querySelector('[aria-live="polite"]')?.innerText.trim().length > 0 && ${NEXT}`, "the first words");
        await settledMotion(page);
        expect(await page.evaluate(`${NEXT}.getBoundingClientRect().bottom <= innerHeight && ${NEXT}.disabled`)).toBe(true);

        await page.waitFor(NAME_SHOWN, "the name step");
        expect(await page.evaluate<string>(`document.querySelector('${NAME}').placeholder`)).toBe("");
        expect(page.exceptions).toEqual([]);
    });
});
