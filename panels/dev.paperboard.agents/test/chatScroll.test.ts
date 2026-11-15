// Where the chat is held while its sizes change (real browser, real service).
//
// The chat keeps itself at its end, or at the row someone scrolled up to read,
// through everything that resizes it: a bubble arriving, the message box
// growing. Only a browser lays anything out, so the panel's page runs in
// headless Chrome over its real service (test/support/panel.ts) with a long
// conversation in its storage; the agent (Codex, the fake brain) texts each of
// its replies when the test lets it, and the test changes the message box and
// the scroll as a person would and reads where the chat was left.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ChatEntry } from "../src/contract";
import { release } from "./support/host";
import { bootPanel, seedConversation, type BootedPanel, type Page } from "./support/panel";

setDefaultTimeout(60_000);

/** pixels of rounding a layout may leave */
const ROUNDING = 2;
const SETTINGS = { name: "Ada", harness: "codex" as const, model: null, compaction: "summarize" as const };
const FIELD = 'textarea[aria-label^="Message"]:not([aria-hidden])';
const SAYINGS = [
    "Short one.",
    "A longer message that goes over a few lines in a narrow chat, the way an answer does when it explains what it found and what it would do next.",
    "First line\n\nsecond paragraph\n\nand a third one for good measure.",
];
const TALL = Array.from({ length: 12 }, (_, i) => `line ${i} of a long answer`).join("\n\n");
const LONG_MESSAGE = Array.from({ length: 8 }, (_, i) => `a line of the message ${i}`).join("\n");
// what the agent texts, one at a time, as the test lets it
const REPLIES = ["On it.", TALL, "Something new, below where they are reading.", "Welcome back."];

/** A conversation that overflows the chat many times over, two minutes apart so every bubble is its own group. */
function seed(count: number): ChatEntry[] {
    const start = Date.now() - count * 120_000;
    return Array.from({ length: count }, (_, i) => ({
        id: `seed${String(i).padStart(3, "0")}`,
        at: start + i * 120_000,
        kind: i % 2 ? "agent" : "user",
        text: `${i}. ${SAYINGS[i % SAYINGS.length]}`,
    }));
}

// the page's side: where the chat is, and a wait for it to come to rest
const PAGE_HELPERS = `(() => {
    const list = () => document.querySelector('[aria-live="polite"]').parentElement;
    const bubble = (text) => [...document.querySelectorAll("[data-message]")].find((row) => row.innerText.includes(text));
    window.__chat = {
        list,
        bubble,
        fromEnd: () => list().scrollHeight - list().scrollTop - list().clientHeight,
        shown: (text) => bubble(text).getBoundingClientRect().bottom <= list().getBoundingClientRect().bottom + 1,
        // the first row a reader sees at the top of the chat, and how far down the chat it sits
        topRow: () => {
            const top = list().getBoundingClientRect().top;
            for (const row of document.querySelectorAll("[data-message]")) {
                const box = row.getBoundingClientRect();
                if (box.bottom > top) return { id: row.dataset.message, offset: box.top - top };
            }
            throw new Error("no row is in view");
        },
        offsetOf: (id) => document.querySelector('[data-message="' + id + '"]').getBoundingClientRect().top - list().getBoundingClientRect().top,
        rows: () => document.querySelectorAll("[data-message]").length,
        // types into the message box as a keyboard does: the field changes, then says so
        type: (text) => {
            const field = document.querySelector(${JSON.stringify(FIELD)});
            field.value = text;
            field.dispatchEvent(new InputEvent("input", { bubbles: true }));
        },
        // resolves once the chat has been placed: its scroll and sizes stay the same for 10 frames in a row
        settle: () => new Promise((done, fail) => {
            const deadline = performance.now() + 15000;
            let last = "";
            let still = 0;
            const look = () => {
                const now = list().scrollTop + " " + list().scrollHeight + " " + list().clientHeight;
                still = now === last ? still + 1 : 0;
                last = now;
                if (still >= 10) return done();
                if (performance.now() > deadline) return fail(new Error("the chat never came to rest"));
                requestAnimationFrame(look);
            };
            look();
        }),
    };
})()`;

let panel: BootedPanel;
let page: Page;
const chat = <T = unknown>(expression: string) => page.evaluate<T>(`(async () => { const c = window.__chat; return ${expression}; })()`);
const settle = () => chat("c.settle()");
let replies = 0;
/** The agent texts its next reply; resolves once its bubble is on the page. */
async function arrive(): Promise<string> {
    const text = REPLIES[replies++]!;
    release(panel.fake);
    await page.waitFor(`window.__chat.bubble(${JSON.stringify(text)})`, `the reply "${text.slice(0, 20)}"`);
    return text;
}

const results: Record<string, any> = {};
beforeAll(async () => {
    panel = await bootPanel({
        settings: SETTINGS,
        codexOnPath: { signedIn: true, chosen: true, plan: { replies: REPLIES } },
        seed: async (storage) => void seedConversation(storage, seed(150)),
    });
    page = await panel.open();
    await page.resize(420, 640);
    await page.waitFor(`document.querySelector('[data-message="seed149"]')`, "the conversation");
    await page.evaluate(PAGE_HELPERS);
    await settle();
    results.opened = { fromEnd: await chat("c.fromEnd()"), overflows: await chat("c.list().scrollHeight > c.list().clientHeight * 3") };

    // someone at the end asks for news: the agent's replies come one at a time
    await page.type(FIELD, "Keep me posted [[replies]]");
    await page.waitFor(`!document.querySelector('button[aria-label="Send"]').disabled`, "Send to be ready");
    await page.click('button[aria-label="Send"]');
    await page.waitFor(`window.__chat.bubble("Keep me posted")`, "the message in the chat");
    await settle();
    for (const name of ["arrivedShort", "arrivedTall"]) {
        const text = await arrive();
        await settle();
        results[name] = { fromEnd: await chat("c.fromEnd()"), shown: await chat(`c.shown(${JSON.stringify(text)})`) };
    }

    // the message box grows as someone writes a long message, then shrinks as it is cleared
    const heightBefore = await chat<number>("c.list().clientHeight");
    await chat(`c.type(${JSON.stringify(LONG_MESSAGE)})`);
    await settle();
    results.grown = { fromEnd: await chat("c.fromEnd()"), listShrankBy: heightBefore - (await chat<number>("c.list().clientHeight")) };
    await chat(`c.type("")`);
    await settle();
    results.cleared = { fromEnd: await chat("c.fromEnd()"), listRestored: (await chat<number>("c.list().clientHeight")) === heightBefore };

    // a reader who scrolled up to the middle: a bubble arrives below them
    await chat("c.list().scrollTop = (c.list().scrollHeight - c.list().clientHeight) / 2");
    await settle();
    const read = await chat<{ id: string; offset: number }>("c.topRow()");
    const readAt = await chat<number>("c.list().scrollTop");
    await arrive();
    await settle();
    results.whileArriving = {
        moved: (await chat<number>(`c.offsetOf(${JSON.stringify(read.id)})`)) - read.offset,
        away: await chat("c.fromEnd()"),
        scrollMoved: (await chat<number>("c.list().scrollTop")) - readAt,
    };

    // the same reader, and the message box grows under them
    await chat(`c.type(${JSON.stringify(LONG_MESSAGE)})`);
    await settle();
    results.whileGrowing = { moved: (await chat<number>(`c.offsetOf(${JSON.stringify(read.id)})`)) - read.offset, away: await chat("c.fromEnd()") };
    await chat(`c.type("")`);
    await settle();

    // the same reader goes up to the top: older rows are drawn above them, and what they read stays where it was
    await chat("c.list().scrollTop = 300");
    await settle();
    const top = await chat<{ id: string; offset: number }>("c.topRow()");
    const rowsBefore = await chat<number>("c.rows()");
    await chat("c.list().scrollTop = 20");
    await settle();
    results.reachedTop = {
        olderRowsDrawn: (await chat<number>("c.rows()")) - rowsBefore,
        // they moved 280 pixels up the chat, so the row is 280 pixels further down the view
        moved: (await chat<number>(`c.offsetOf(${JSON.stringify(top.id)})`)) - (top.offset + 280),
    };

    // and a reader scrolling back down to the end is held there again
    await chat("c.list().scrollTop = c.list().scrollHeight");
    await settle();
    const back = await arrive();
    await settle();
    results.returned = { fromEnd: await chat("c.fromEnd()"), shown: await chat(`c.shown(${JSON.stringify(back)})`) };
});
afterAll(() => panel?.close());

describe("the chat's scroll", () => {
    test("a long conversation opens at its end", () => {
        expect(results.opened.overflows, "the conversation has to be long for this to mean anything").toBe(true);
        expect(results.opened.fromEnd).toBeLessThanOrEqual(ROUNDING);
    });

    test("the chat stays at its end when a bubble arrives, a tall one too", () => {
        for (const arrived of [results.arrivedShort, results.arrivedTall]) {
            expect(arrived.fromEnd).toBeLessThanOrEqual(ROUNDING);
            expect(arrived.shown, "the new bubble was below the view").toBe(true);
        }
    });

    test("the chat stays at its end when the message box grows and shrinks", () => {
        expect(results.grown.listShrankBy, "the message box did not grow").toBeGreaterThan(20);
        expect(results.grown.fromEnd).toBeLessThanOrEqual(ROUNDING);
        expect(results.cleared.listRestored).toBe(true);
        expect(results.cleared.fromEnd).toBeLessThanOrEqual(ROUNDING);
    });

    test("a reader who scrolled up stays on the same row when a bubble arrives, and when the message box grows", () => {
        const { whileArriving, whileGrowing } = results;
        expect(whileArriving.away, "the reader was taken to the end").toBeGreaterThan(200);
        expect(Math.abs(whileArriving.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
        expect(Math.abs(whileArriving.scrollMoved), "the chat scrolled under them").toBeLessThanOrEqual(ROUNDING);
        expect(whileGrowing.away).toBeGreaterThan(200);
        expect(Math.abs(whileGrowing.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
    });

    test("older rows drawn above a reader who reached the top leave them on the same row", () => {
        expect(results.reachedTop.olderRowsDrawn, "no older rows were drawn").toBeGreaterThan(0);
        expect(Math.abs(results.reachedTop.moved), "the row they were reading moved").toBeLessThanOrEqual(ROUNDING);
    });

    test("a reader who scrolls back to the end is held there again, and nothing fails unseen", () => {
        expect(results.returned.fromEnd).toBeLessThanOrEqual(ROUNDING);
        expect(results.returned.shown).toBe(true);
        expect(page.exceptions).toEqual([]);
    });
});
