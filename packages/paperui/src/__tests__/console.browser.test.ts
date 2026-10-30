import { describe, test, expect } from "vitest";
import { findChrome, runFixture } from "./fixtures/browserHarness";

const chrome = findChrome();
describe("PaperConsole with a large, fast log", () => {
    (chrome ? test : test.skip)(
        chrome
            ? "mounts a window of rows, follows the tail, and holds still while reading"
            : "console windowing (skipped: no Chrome)",
        async () => {
            const result = await runFixture(chrome!, "src/__tests__/fixtures/consoleFixture.html");
            expect(result.error).toBe("");
            expect(result.checks).toEqual({
                windowed: true,
                startsAtBottom: true,
                newestShown: true,
                contiguous: true,
                followsBurst: true,
                windowedAfterBurst: true,
                middleFilled: true,
                middleContiguous: true,
                readingHeld: true,
                notFollowing: true,
                followsAgain: true,
            });
        },
        60000,
    );
});
