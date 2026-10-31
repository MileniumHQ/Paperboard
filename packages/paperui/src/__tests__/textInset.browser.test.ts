import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("text presets and inset", () => {
    (chrome ? test : test.skip)(chrome ? "presets render their role and inset text lines up with a card's text" : "text presets (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/textInsetFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({
            headerAlignsWithRow: true,
            insetWraps: true,
            insetAlignsWithRow: true,
            heading: ["14px", "700", true],
            label: ["18px", "600"],
            hint: ["14px", "400", true],
            error: ["14px", true],
            textLeading: "normal",
            bodyLeading: 1.75,
        });
    }, 60000);
});
