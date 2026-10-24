import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("PaperSlidePage layout switch", () => {
    (chrome ? test : test.skip)(chrome ? "turning into the phone layout doesn't slide the closed page out; opening slides it in" : "slide page switch (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/slidePageFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({ switchSlides: false, switchSlidesLater: false, openSlides: true });
    }, 60000);
});
