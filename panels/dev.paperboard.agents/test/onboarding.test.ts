// Meeting the agent for the first time (real browser, real frames): the real
// Main on real PaperUI over a fake Agent service. The Name field's
// placeholder names what goes in it, the sign-in card's line and buttons
// start at one edge, and finishing fades the meeting out and the chat in.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("meeting the agent", () => {
    browserTest(
        chrome ? "from its name to the chat (headless Chrome)" : "from its name to the chat (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/onboardingFixture.html", { "@mileniumhq/paperapi": "test/fixtures/agentsApi.ts" }, { realTime: true });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.namePlaceholder, "the placeholder names what goes in, never a sample name").toBe("Name");
            expect(c.buttonLeft, "the sign-in buttons start where the line above them does").toBe(c.lineLeft);
            expect(c.meetingFaded, "the meeting fades out").toBe(true);
            expect(c.chatFaded, "the chat fades in").toBe(true);
            expect(c.chatSettled, "and ends fully shown").toBe(1);
            expect(c.neverBoth, "the chat comes once the meeting has gone").toBe(true);
        },
        120_000,
    );
});
