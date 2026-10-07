import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("PaperList tab overflow", () => {
    (chrome ? test : test.skip)(
        chrome
            ? "scrolls vertical and horizontal tabs instead of compressing them"
            : "tab overflow (skipped: no Chrome)",
        async () => {
            const result = await runFixture(
                chrome!,
                "src/__tests__/fixtures/listScrollFixture.html",
            );
            expect(result.error).toBe("");
            expect(result.checks).toMatchObject({
                // The list owns the overflow on its layout axis, so the
                // browser scrolls it rather than the flexbox crushing rows.
                verticalOverflow: "auto",
                verticalFits: true,
                verticalScrolls: true,
                horizontalOverflow: "auto",
                horizontalFits: true,
                horizontalScrolls: true,
            });
        },
        60000,
    );
});
