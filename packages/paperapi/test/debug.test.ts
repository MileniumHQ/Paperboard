import { test, expect } from "bun:test";
import { debugErr } from "../src/debug";

test("debugErr never lets the caller's text act as a format string", () => {
    const calls: unknown[][] = [];
    const orig = console.error;
    (console as any).error = (...a: unknown[]) => calls.push(a);
    try {
        debugErr("bad %s %d %o place", new Error("boom"));
    } finally {
        (console as any).error = orig;
    }
    expect(calls).toHaveLength(1);
    // the only format string is ours; the caller's text travels as data
    expect(calls[0][0]).toBe("[transport] %s:");
    expect(calls[0][1]).toBe("bad %s %d %o place");
});
