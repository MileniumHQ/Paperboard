import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("settings multiline layout", () => {
    (chrome ? test : test.skip)(chrome ? "adapts dynamically while keeping the editor usable" : "multiline layout (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/settingsFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({ singleLineDirection: "row", multilineDirection: "column", fullWidth: true, focusable: true, restoredDirection: "row" });
    }, 60000);
});
