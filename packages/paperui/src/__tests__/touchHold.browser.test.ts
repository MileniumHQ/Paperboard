import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("touch hold", () => {
    (chrome ? test : test.skip)(chrome ? "holding a finger still opens the context menu once and doesn't click what's under it" : "touch hold (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/touchHoldFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({
            heldOpensOnce: true,
            heldDoesNotClick: true,
            tapClicks: "item",
            // a finger that moved isn't holding: only the browser's own event, if it sends one
            movedOpensNoExtra: 1,
            unhandledStillClicks: "plain",
        });
    }, 60000);
});
