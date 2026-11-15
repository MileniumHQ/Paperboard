// A tool server's sign-in in a real browser (fixtures/signInFixture.tsx): an
// address caught on this device that the server refuses can be pasted again.
import { describe, expect, test } from "bun:test";
import { runBrowserFixture } from "./browserFixture";

describe("a tool server's sign-in, on another device", () => {
    test(
        "a caught address the server refuses says why, and the address can be pasted",
        async () => {
            const { checks, error } = await runBrowserFixture("test/fixtures/signInFixture.html", { "@mileniumhq/paperapi": "test/fixtures/loopbackStub.ts" });
            expect(error, "the fixture threw").toBe("");
            expect(checks.handed).toEqual(["http://localhost:1455/callback?code=caught"]);
            expect(checks.canPaste, "no field to paste the address in").toBe(true);
            expect(checks.uncaught).toEqual([]);
        },
        180_000,
    );
});
