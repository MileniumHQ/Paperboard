import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("PaperPageHeader on a phone", () => {
    (chrome ? test : test.skip)(chrome ? "a few icon actions stay beside the title; a wide row wraps" : "page header wrap (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/pageHeaderFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({ iconsBeside: true, wordsBeside: false });
    }, 60000);
});
