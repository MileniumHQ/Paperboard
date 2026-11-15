// A tool server's sign-in in a real browser (fixtures/signInFixture.tsx): an
// address caught on this device that the server refuses can be pasted again.
//
// Without Chrome the suite is skipped with a visible reason; CI must have it.
import { describe, expect, test } from "bun:test";
import { findChrome, runBrowserFixture } from "./browserFixture";

const chrome = findChrome();
if (!chrome && process.env.CI) throw new Error("CI has no Chrome, so the sign-in's tests can't run: install it or set PAPERBOARD_CHROME");
const browserTest = chrome ? test : test.skip;
const named = (name: string) => (chrome ? `${name} (headless Chrome)` : `${name} (skipped: no Chrome)`);

describe("a tool server's sign-in, on another device", () => {
    browserTest(
        named("a caught address the server refuses says why, and the address can be pasted"),
        async () => {
            const { checks, error } = await runBrowserFixture(chrome!, "test/fixtures/signInFixture.html", { "@mileniumhq/paperapi": "test/fixtures/loopbackStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.handed).toEqual(["http://localhost:1455/callback?code=caught"]);
            expect(checks.canPaste, "no field to paste the address in").toBe(true);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
