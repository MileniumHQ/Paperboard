// What goes into and out of a message, in the real chat over the real
// service (test/support/panel.ts), with Codex as the fake brain: pressing
// Send sends once, a YouTube link's thumbnail comes through the service, and
// a slow history never puts another conversation in the chat. The page's
// socket (test/support/wire.ts) decides only when a call or its answer gets
// through. The one answer the test gives itself is the thumbnail's: the
// service would fetch it from YouTube, and a test reaches no internet.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bootPanel, frames, seedConversation, type BootedPanel, type Page } from "./support/panel";
import { answerHeld, deliverAnswer, heldAnswers, heldCalls, holdAnswers, holdCalls, releaseCall, sent, WIRE } from "./support/wire";

setDefaultTimeout(60_000);

const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
// a 1x1 PNG, the thumbnail as the service would hand it over
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==";
const REPLY = "Here it is:\n\n![How to make pasta](https://www.youtube.com/watch?v=dQw4w9WgXcQ)";
const FIELD = 'textarea[aria-label^="Message"]:not([aria-hidden])';
const SEND = 'button[aria-label="Send"]';

const past = (id: string, text: string, at: number) => [
    { id: `${id}0`, at, kind: "user" as const, text: `Tell me about ${id}` },
    { id, at: at + 1, kind: "agent" as const, text },
];

let panel: BootedPanel;
let page: Page;
const ids: Record<string, string> = {};
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        codexOnPath: { signedIn: true, chosen: true, plan: { reply: REPLY } },
        // two conversations in the history to switch to
        seed: async (storage) => {
            ids.first = seedConversation(storage, past("first1", "The conversation switched to first", 1_000), { putAway: true })!;
            ids.last = seedConversation(storage, past("last1", "The conversation switched to last", 2_000), { putAway: true })!;
        },
    });
    page = await panel.open({ init: WIRE });
    await page.waitFor(`document.querySelector('${FIELD}')`, "the message box");
});
afterAll(() => panel?.close());

/** Picks a past conversation in the history, as a person would. */
async function reopen(id: string): Promise<void> {
    // the history from the switch before has closed, so the button is there to press
    await page.waitFor(`!document.querySelector('input[name="agents-history"]')`, "the history to close");
    await page.motionSettled();
    await page.click('button[aria-label="Past conversations"]');
    const item = `input[name="agents-history"][value="${id}"]`;
    await page.waitFor(`document.querySelector('${item}') && !document.querySelector('${item}').disabled`, "the past conversation in the history");
    await page.motionSettled();
    await page.click(item);
}

describe("a message", () => {
    test("pressed twice, and Ctrl+Enter on top, is sent once, and what was typed meanwhile stays in the box", async () => {
        await holdCalls(page, "send");
        // the agent's reply names a YouTube video: its thumbnail is asked for, held for the next test
        await holdCalls(page, "webImage");
        await page.type(FIELD, "Find me a recipe");
        await page.waitFor(`!document.querySelector('${SEND}').disabled`, "Send to be ready");
        // pressed twice, and Ctrl+Enter on top, while the first is on its way; more is typed meanwhile
        await page.evaluate(`(() => {
            const send = document.querySelector('${SEND}');
            const field = document.querySelector('${FIELD}');
            send.click();
            send.click();
            field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
            field.value = "Find me a recipe and a wine";
            field.dispatchEvent(new InputEvent("input", { bubbles: true }));
        })()`);
        const inFlight = await sent(page, "send");
        expect(inFlight, "the message was sent more than once").toHaveLength(1);
        await releaseCall(page, "send");
        await page.waitFor(`document.querySelector('${FIELD}').value !== "Find me a recipe and a wine"`, "the message to arrive");
        expect((inFlight[0] as { text: string }).text).toBe("Find me a recipe");
        expect(await page.evaluate(`document.querySelector('${FIELD}').value`)).toBe("and a wine");
        expect(await sent(page, "send"), "the message was sent again once it arrived").toHaveLength(1);
        expect(page.exceptions).toEqual([]);
    });

    test("a YouTube link shows its thumbnail as the service fetched it, and the page asks YouTube for nothing", async () => {
        await page.waitFor(`window.__wireApi.heldCalls("web-image") > 0`, "the agent's reply to ask for its thumbnail");
        expect(await sent(page, "webImage")).toEqual([{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }]);
        await answerHeld(page, "webImage", { type: "image/png", data: PNG });
        const thumb = `document.querySelector('[data-message] img[alt="How to make pasta"]')`;
        await page.waitFor(`${thumb}?.complete && ${thumb}.naturalWidth > 0`, "the thumbnail to be drawn");
        expect(await page.evaluate(`${thumb}.src.split(":")[0]`)).toBe("blob");
        expect(await page.evaluate(`${thumb}.closest("a")?.getAttribute("href")`)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        // everything the page has asked a host for, by URL: what it loaded and what its elements point at
        const asked = await page.evaluate<string[]>(`[
            ...performance.getEntriesByType("resource").map((e) => e.name),
            ...[...document.querySelectorAll("[src], [srcset]")].flatMap((el) => [el.getAttribute("src") ?? "", el.getAttribute("srcset") ?? ""]).filter(Boolean),
        ]`);
        expect(asked.filter((url) => /ytimg\.com|youtube\.com/.test(url))).toEqual([]);
        expect(await heldCalls(page, "webImage")).toBe(0);
        expect(page.exceptions).toEqual([]);
    });

    test("switched twice, the chat shows the last conversation, even when the first one's history answers last", async () => {
        await holdAnswers(page, "history");
        // the first switch: the service answers with that conversation's history, which is slow to arrive
        await reopen(ids.first!);
        await page.waitFor(`window.__wireApi.heldAnswers("history") === 1`, "the first conversation's history to be answered");
        await reopen(ids.last!);
        await page.waitFor(`window.__wireApi.heldAnswers("history") === 2`, "the last conversation's history to be answered");
        await deliverAnswer(page, "history", "newest");
        await page.waitFor(`document.querySelector('[data-message="last1"]')`, "the last conversation's history");
        await deliverAnswer(page, "history", "oldest");
        await frames(page);
        expect(await heldAnswers(page, "history")).toBe(0);
        expect(await page.evaluate(`Boolean(document.querySelector('[data-message="last1"]'))`), "the last conversation's history is gone").toBe(true);
        expect(await page.evaluate(`Boolean(document.querySelector('[data-message="first1"]'))`), "the first conversation's late history replaced it").toBe(false);
        expect(page.exceptions).toEqual([]);
    });
});
