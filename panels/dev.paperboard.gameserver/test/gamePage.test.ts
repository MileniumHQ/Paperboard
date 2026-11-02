// The server page as a whole (real browser, real PaperUI): state pushed by
// the service never remounts the open tab, and a game's state is never read
// as another game's. Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("server page", () => {
    behaviorTest(
        chrome
            ? "options stay put while state arrives, every tab has its page header, and Palworld state is never described as Minecraft (headless Chrome)"
            : "options stay put while state arrives, every tab has its page header, and Palworld state is never described as Minecraft (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/gamePage.html?server=s1", {});
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            expect(c.refused, "the page described a server as the wrong game").toEqual([]);
            expect(c.optionsShown).toBe(true);
            expect(c.readsWhileShown, "the options tab kept reloading itself").toBe(0);
            expect(c.mutationsWhileIdle, "the page kept re-rendering").toBe(0);
            expect(c.unheaded, "these tabs open without a page header").toEqual([]);
        },
        120_000,
    );
});
