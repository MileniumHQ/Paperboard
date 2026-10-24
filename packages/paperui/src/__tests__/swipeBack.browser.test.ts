import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("touch back swipe", () => {
    (chrome ? test : test.skip)(chrome ? "a finger swipes an open page back from its content, a frame's report drives its page, and gestures that belong to the content stay theirs" : "touch back swipe (skipped: no Chrome)", async () => {
        const result = await runFixture(chrome!, "src/__tests__/fixtures/swipeBackFixture.html");
        expect(result.error).toBe("");
        expect(result.checks).toEqual({
            keptOpen: true,
            wentBack: true,
            reported: "move,move,move,move,end",
            junkRefused: false,
            frameDrags: "translateX(200px)",
            frameWentBack: true,
            closedFrameIgnored: false,
        });
    }, 60000);
});
