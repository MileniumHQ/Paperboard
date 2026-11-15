// Settings in a real browser over the real service (test/support/panel.ts),
// with Codex on the computer as the fake brain: what is typed and picked is
// what gets saved, a refused save keeps what was typed, and the models
// follow the brain.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, openSection, type BootedPanel, type BootOptions, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const MODELS = { models: { stdout: JSON.stringify({ models: [{ slug: "gpt-x", display_name: "GPT X", visibility: "list", priority: 1 }] }) } };

let panel: BootedPanel | null = null;
afterEach(async () => {
    await panel?.close();
    panel = null;
});

async function settingsPage(o: BootOptions): Promise<Page> {
    panel = await bootPanel({ settings: SETTINGS, ...o });
    const page = await panel.open();
    await openSection(page, "Ada", "settings");
    await page.waitFor(`document.querySelector('[role=region][aria-label="Agent"] input[name="name"]')`, "the settings");
    return page;
}

const NAME = `document.querySelector('[role=region][aria-label="Agent"] input[name="name"]')`;
const FLOWS = `document.querySelector('[role=region][aria-label="Flows"] textarea')`;
/** the alert in a region of the settings whose text includes `title` */
const alertIn = (region: string, title: string) =>
    `[...document.querySelectorAll('[role=region][aria-label="${region}"] [role=alert]')].find((a) => a.innerText.includes(${JSON.stringify(title)}))`;

/** Puts `text` in a field and leaves it, as typing it and moving on would: one input, then the change. */
const fill = (field: string, text: string) => `(() => {
    const el = ${field};
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
})()`;

describe("a save the service refuses", () => {
    test("keeps the name and the flow instructions as they were typed, and says why", async () => {
        // Codex is on the computer but not set up, so the service refuses every save
        const page = await settingsPage({ codexOnPath: { signedIn: true } });
        await page.evaluate(fill(NAME, "Grace"));
        await page.waitFor(alertIn("Agent", "Name not saved"), "the name's refusal");
        expect(await page.evaluate(`${alertIn("Agent", "Name not saved")}.innerText`)).toContain("Codex isn't ready");
        expect(await page.evaluate(`${NAME}.value`)).toBe("Grace");

        await page.evaluate(fill(FLOWS, "Reply with just the answer."));
        await page.waitFor(alertIn("Flows", "Instructions not saved"), "the instructions' refusal");
        expect(await page.evaluate(`${FLOWS}.value`)).toBe("Reply with just the answer.");
        await page.settled();
        // nothing was saved
        expect(panel!.savedSettings()).toEqual(SETTINGS);
        expect(page.exceptions).toEqual([]);
    });
});

describe("a pick", () => {
    test("shows at once, and goes back to what's saved when the save is refused", async () => {
        // refused like every save here, because Codex isn't set up
        const page = await settingsPage({ codexOnPath: { signedIn: true } });
        const COMPACTION = `document.querySelector('[role=region][aria-label="Conversation"] input[name="compaction"]')`;
        // read in the same task as the press, before the save can be back
        const shown = await page.evaluate(`(() => {
            document.querySelector('[role=region][aria-label="Conversation"] input[name="compaction"] ~ button[aria-haspopup=listbox]').click();
            document.querySelector('[role=option][data-select-value="forget"]').click();
            return ${COMPACTION}.value;
        })()`);
        expect(shown).toBe("forget");
        await page.waitFor(alertIn("Conversation", "Compaction not changed"), "the compaction's refusal");
        await page.waitFor(`${COMPACTION}.value === "summarize"`, "the saved compaction back");
        expect(panel!.savedSettings()).toEqual(SETTINGS);
        expect(page.exceptions).toEqual([]);
    });
});

describe("the models", () => {
    test("are listed again once the brain is set up, and the error that it wasn't goes", async () => {
        const page = await settingsPage({ codexOnPath: { signedIn: true, plan: MODELS } });
        await page.waitFor(alertIn("Agent", "Models not listed"), "the models not to be listed");
        expect(await page.evaluate(`${alertIn("Agent", "Models not listed")}.innerText`)).toContain("Codex isn't installed");
        // Brains: run the Codex that is on this computer
        await page.waitFor(`[...document.querySelectorAll("button")].some((b) => b.innerText.trim().endsWith("Use it"))`, "Codex to be found on this computer");
        await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith("Use it")).dataset.testUse = "1"`);
        await page.click(`button[data-test-use]`);
        await page.waitFor(`document.querySelector('[role=region][aria-label="Agent"] input[name="model"]') && !${alertIn("Agent", "Models not listed")}`, "the models to be listed");
        await page.click(`[role=region][aria-label="Agent"] input[name="model"] ~ button[aria-haspopup=listbox]`);
        await page.waitFor(`[...document.querySelectorAll("[role=option]")].some((o) => o.innerText.includes("GPT X"))`, "Codex's model in the list");
        expect(page.exceptions).toEqual([]);
    });
});

describe("settings changed one after another", () => {
    test("are all saved, and shown so in the next window", async () => {
        const page = await settingsPage({ codexOnPath: { signedIn: true, chosen: true, plan: MODELS } });
        // the name, the compaction and the flow instructions, each changed before the last one's save is back
        await page.evaluate(`(() => {
            ${fill(NAME, "Grace")};
            document.querySelector('[role=region][aria-label="Conversation"] input[name="compaction"] ~ button[aria-haspopup=listbox]').click();
            document.querySelector('[role=option][data-select-value="forget"]').click();
            ${fill(FLOWS, "Reply with just the answer.")};
        })()`);
        // the saves go one after another; the last one in has all three
        await panel!.settingsSaved({ ...SETTINGS, name: "Grace", compaction: "forget", automationInstructions: "Reply with just the answer." });

        const next = await panel!.open();
        await openSection(next, "Grace", "settings");
        await next.waitFor(`${NAME}?.value === "Grace"`, "the saved name");
        expect(await next.evaluate(`document.querySelector('[role=region][aria-label="Conversation"] input[name="compaction"]').value`)).toBe("forget");
        expect(await next.evaluate(`${FLOWS}.value`)).toBe("Reply with just the answer.");
        expect([...page.exceptions, ...next.exceptions]).toEqual([]);
    });
});
