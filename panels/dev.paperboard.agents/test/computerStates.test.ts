// The agent's computer before it is ready, in a real browser
// (fixtures/computerStates.tsx, over a stand-in agent: see why there): not
// set up, setting up and a failed setup each sit in the middle of the page,
// with the one thing to do.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

describe("the computer before it is ready", () => {
    test(
        "every state is centered in the page, with its one action",
        async () => {
            const { checks, error } = await runBrowserFixture("test/fixtures/computerStates.html");
            expect(error, "the fixture threw").toBe("");
            for (const [state, off] of Object.entries(checks.offsets as Record<string, { x: number; y: number }>)) {
                expect(Math.abs(off.x), `${state} sits off center sideways by ${off.x}px`).toBeLessThanOrEqual(2);
                expect(Math.abs(off.y), `${state} sits off center up or down by ${off.y}px`).toBeLessThanOrEqual(2);
            }
            expect(checks.none).toEqual(["Set up Ada's computer"]);
            expect(checks.failed).toEqual(["Set up again"]);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
