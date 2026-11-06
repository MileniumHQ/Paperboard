// The onboarding's speaker glides when a step's content re-centers the
// column instead of jumping a frame (real browser: layout, ResizeObserver
// and Web Animations are the boundary).
//
// Without Chrome the test is skipped with a visible reason.
import { describe, test, expect } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("onboarding speaker", () => {
    browserTest(
        chrome ? "glides when the column re-centers (headless Chrome)" : "glides when the column re-centers (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runBrowserFixture(chrome, "test/fixtures/glideFixture.html", {}, { realTime: true });
            expect(results.error, "the fixture threw").toBe("");
            const c = results.checks;
            expect(c.stillWhereItWas, "content leaving doesn't make the speaker jump").toBe(true);
            expect(c.glidesDown, "it glides there").toBe(true);
            expect(c.movedDown, "it ends lower, centered again").toBe(true);
            expect(c.settledInPlace, "it comes to rest in its laid-out place").toBe(true);
            expect(c.stillWhereItWasBack, "content arriving doesn't make it jump either").toBe(true);
            expect(c.glidesBack, "it glides back").toBe(true);
            expect(c.backInPlace, "it glides back to where it started").toBe(true);
        },
        120_000,
    );
});
