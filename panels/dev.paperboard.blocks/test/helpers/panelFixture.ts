// The whole panel in headless Chrome (test/fixtures/panelFixture.tsx) over a
// service that announces its state as the daemon delivers it, run once per
// test process: every file that asks shares the one run's results.
import { expect } from "bun:test";
import { browserFixture } from "../browserFixture";

/** What the fixture saw; fails the test when the fixture itself threw. */
export async function panelFixture(): Promise<Record<string, any>> {
    const { checks, error } = await browserFixture("panel");
    expect(error, "the fixture threw").toBe("");
    expect(checks.uncaught, "the panel threw").toEqual([]);
    return checks;
}
