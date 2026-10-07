import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("PaperList compact selection", () => {
    (chrome ? test : test.skip)(
        chrome
            ? "a row that suppresses its radio reopens on every click"
            : "compact row selection (skipped: no Chrome)",
        async () => {
            const result = await runFixture(
                chrome!,
                "src/__tests__/fixtures/compactListFixture.html",
            );
            expect(result.error).toBe("");
            expect(result.checks).toMatchObject({
                compactFirstOpen: "Alice",
                compactRadioCleared: true,
                compactReopen: "Alice",
                plainFirstOpen: "Alice",
            });
            // control: without suppression the second click is swallowed by the
            // already-checked radio — the bug the compact branch fixes
            expect(result.checks.plainReopen).toBeNull();
        },
        60000,
    );
});
