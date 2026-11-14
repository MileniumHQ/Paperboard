// The whole panel in headless Chrome (test/fixtures/panelFixture.tsx) over a
// service that announces its state as the daemon delivers it, run once per
// test process: every file that asks shares the one run's results.
import { expect } from "bun:test";
import { findChrome, runBrowserFixture, type FixtureResults } from "../browserFixture";

export const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the panel's browser tests can't run: install it or set PAPERBOARD_CHROME");

let results: Promise<FixtureResults> | undefined;
/** What the fixture saw; fails the test when the fixture itself threw. */
export async function panelFixture(): Promise<Record<string, any>> {
    results ??= runBrowserFixture(chrome!, "test/fixtures/panelFixture.html", { "@mileniumhq/paperapi": "test/fixtures/serviceStub.ts" });
    const { checks, error } = await results;
    expect(error, "the fixture threw").toBe("");
    expect(checks.uncaught, "the panel threw").toEqual([]);
    return checks;
}

export const browserTest = (name: string) => (chrome ? `${name} (headless Chrome)` : `${name} (skipped: no Chrome)`);
