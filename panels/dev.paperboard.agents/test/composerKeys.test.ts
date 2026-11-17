// The keys of the message box, pressed as a keyboard would: on a desktop
// Enter sends and Shift+Enter breaks the line; on a phone (PaperUI's mobile
// mode) Enter breaks the line, since its keyboard has no Shift+Enter, and
// the send button sends. The page's socket (test/support/wire.ts) holds
// each send, so what was sent is counted before the service answers it.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, type BootedPanel, type Page } from "./support/panel";
import { holdCalls, releaseCall, sent, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const FIELD = 'textarea[aria-label^="Message"]:not([aria-hidden])';
const SHIFT = 8;
const CTRL = 2;

let panel: BootedPanel;
let page: Page;
beforeAll(async () => {
    panel = await bootPanel({ settings: SETTINGS, codexOnPath: { signedIn: true, chosen: true, plan: { reply: "Hi" } } });
    page = await panel.open({ init: WIRE });
    await page.waitFor(`document.querySelector('${FIELD}')`, "the message box");
    await holdCalls(page, "send");
});
afterAll(() => panel?.close());

/** Presses Enter in the message box, with `modifiers` (CDP's bit mask) held. */
async function enter(modifiers = 0): Promise<void> {
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers };
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

const value = () => page.evaluate<string>(`document.querySelector('${FIELD}').value`);
const texts = async () => ((await sent(page, "send")) as { text: string }[]).map((m) => m.text);
const mobile = (on: boolean) => page.evaluate(`document.documentElement.setAttribute("data-paper-mobile", "${on}")`);

describe("the message box", () => {
    test("on a desktop, Shift+Enter breaks the line and Enter sends", async () => {
        await mobile(false);
        await page.type(FIELD, "Find me a recipe");
        await enter(SHIFT);
        await page.type(FIELD, "with pasta");
        expect(await value()).toBe("Find me a recipe\nwith pasta");
        expect(await texts(), "Shift+Enter sent the message").toEqual([]);
        await enter();
        await page.waitFor(`window.__wireApi.sent("send").length === 1`, "Enter to send the message");
        expect(await texts()).toEqual(["Find me a recipe\nwith pasta"]);
        expect(await value(), "Enter also broke the line").toBe("Find me a recipe\nwith pasta");
        // on its way, the message leaves the box
        await releaseCall(page, "send");
        await page.waitFor(`document.querySelector('${FIELD}').value === ""`, "the message to leave the box");
        expect(page.exceptions).toEqual([]);
    });

    test("on a phone, Enter breaks the line, and Ctrl+Enter still sends", async () => {
        await mobile(true);
        await page.type(FIELD, "And a wine");
        await enter();
        await page.type(FIELD, "to go with it");
        expect(await value()).toBe("And a wine\nto go with it");
        expect(await texts(), "Enter sent the message on a phone").toEqual(["Find me a recipe\nwith pasta"]);
        await enter(CTRL);
        await page.waitFor(`window.__wireApi.sent("send").length === 2`, "Ctrl+Enter to send the message");
        expect((await texts())[1]).toBe("And a wine\nto go with it");
        expect(page.exceptions).toEqual([]);
    });
});
