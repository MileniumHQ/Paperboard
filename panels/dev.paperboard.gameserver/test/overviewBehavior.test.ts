// The shared Overview and Chat as a person meets them (real browser, real
// PaperUI): a save, a console command or a chat message the server refuses
// says so on screen, with the server's reason. Every game renders these.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("shared overview behavior", () => {
    behaviorTest(
        chrome
            ? "refused save, command and chat are shown with their reason (headless Chrome)"
            : "refused save, command and chat are shown with their reason (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/overviewBehavior.html?server=s1", {});
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.saveShown, "a running server offers Save world in the shared Overview").toBe(true);
            expect(c.saveFailureTitled).toBe(true);
            expect(c.saveFailureReason, "the save failure carries the server's reason").toBe(true);
            expect(c.commandFailureTitled, "a refused console command is shown").toBe(true);
            expect(c.commandFailureReason).toBe(true);
            expect(c.chatFailureTitled, "a refused chat message is shown").toBe(true);
            expect(c.chatFailureReason).toBe(true);
            expect(c.broadcastSent, "a broadcast line is a message, not a command").toEqual(["s1/say-chat"]);
            expect(c.broadcastFailureReason, "a refused broadcast is shown with its reason").toBe(true);
            expect(c.chatKeepsMessage, "an unsent message comes back to the field").toBe("hello world");
            expect(c.sayButtonSends, "clicking Say sends the message, not only pressing Enter").toBe(true);
            expect(c.calls).toEqual(expect.arrayContaining(["s1/save-world", "s1/run-command", "s1/say-chat"]));
        },
        120_000,
    );
});
