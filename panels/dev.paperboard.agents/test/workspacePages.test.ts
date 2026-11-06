// Switching between the pages of the workspace menu (real browser, real
// frames): the real Main on real PaperUI over a fake Agents service that
// takes a moment to answer. No frame between two pages may be empty or a
// loader, a slow read shows its loader after a moment, and the Computer page
// is on the same surface as the rest.
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

type Switch = { blank: number; loader: number; settled: boolean };

describe("switching workspace pages", () => {
    browserTest(
        chrome ? "never paints an empty page in between (headless Chrome)" : "never paints an empty page in between (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/workspacePagesFixture.html", { "@mileniumhq/paperapi": "test/fixtures/agentsApi.ts" }, { realTime: true });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.uncaught, "nothing may fail out of sight").toEqual([]);
            for (const name of ["memories", "routines", "tools", "settings", "backToMemories"]) {
                const s = c[name] as Switch;
                expect(s.settled, `${name}: the page arrives`).toBe(true);
                expect(s.blank, `${name}: no empty frame on the way`).toBe(0);
                expect(s.loader, `${name}: no loader for a read that's in within a moment`).toBe(0);
            }
            expect(c.slowShowsLoader, "a slow read shows the page with its loader, not the last page").toBe(true);
            expect(c.slowTitle, "and the title follows").toContain("Routines");
            expect(c.computerSurface, "the Computer page is on the same surface as the others").toBe(c.memoriesSurface);
        },
        120_000,
    );
});
