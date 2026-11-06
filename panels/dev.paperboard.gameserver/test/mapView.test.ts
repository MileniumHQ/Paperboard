// The Map tab as a person opens it (real browser, real PaperUI): a new world's few
// chunks fill the view instead of sitting small in a corner of their region, and a
// player's marker draws in the theme's danger colour, which a canvas only gets as a value.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const behaviorTest = chrome ? test : test.skip;

describe("map view", () => {
    behaviorTest(
        chrome
            ? "the map opens on the generated terrain, its player marked in the danger colour (headless Chrome)"
            : "the map opens on the generated terrain, its player marked in the danger colour (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/map.html?server=s1", {});
            expect(results.error).toBe("");
        },
        120_000,
    );
});
