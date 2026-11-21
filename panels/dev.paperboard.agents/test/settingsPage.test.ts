// Settings in a real browser over the real service (test/support/panel.ts),
// with Codex on the computer as the fake brain: what is typed and picked is
// what gets saved, a refused save keeps what was typed, and the models
// follow the brain.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, openSection, type BootedPanel, type BootOptions, type Page } from "./support/panel";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", color: "blue" as const, harness: "codex" as const, model: null, compaction: "summarize" as const };

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
/** the failure toast whose text includes `title` */
const toast = (title: string) => `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].find((a) => a.innerText.includes(${JSON.stringify(title)}))`;

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
        await page.waitFor(toast("Couldn't save the name"), "the name's refusal");
        expect(await page.evaluate(`${toast("Couldn't save the name")}.innerText`)).toContain("Codex isn't ready");
        expect(await page.evaluate(`${NAME}.value`)).toBe("Grace");

        await page.evaluate(fill(FLOWS, "Reply with just the answer."));
        await page.waitFor(toast("Couldn't save the instructions"), "the instructions' refusal");
        expect(await page.evaluate(`${FLOWS}.value`)).toBe("Reply with just the answer.");
        await page.settled();
        // nothing was saved
        expect(panel!.savedSettings()).toEqual(SETTINGS);
        expect(page.exceptions).toEqual([]);
    });
});

describe("the color", () => {
    test("an agent saved before colors were a choice is blue, and a color picked is saved", async () => {
        const { color: _, ...older } = SETTINGS;
        panel = await bootPanel({ settings: older as typeof SETTINGS, codexOnPath: { signedIn: true, chosen: true } });
        const page = await panel.open();
        await openSection(page, "Ada", "settings");
        const chip = (name: string) => `document.querySelector('[role=region][aria-label="Agent"] [aria-label="${name}"]')`;
        await page.waitFor(chip("Blue"), "the colors");
        expect(await page.evaluate(`${chip("Blue")}.getAttribute("aria-pressed")`)).toBe("true");

        await page.click(`[role=region][aria-label="Agent"] [aria-label="Teal"]`);
        await page.waitFor(`${chip("Teal")}.getAttribute("aria-pressed") === "true"`, "Teal picked");
        await page.settled();
        expect(panel!.savedSettings()).toEqual({ ...SETTINGS, color: "teal" });
        expect(await page.evaluate(`${chip("Blue")}.getAttribute("aria-pressed")`)).toBe("false");
        expect(page.exceptions).toEqual([]);
    });
});
