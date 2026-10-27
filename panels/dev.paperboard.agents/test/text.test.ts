import { describe, expect, test } from "bun:test";
import { clip } from "../src/lib/text";

describe("clip", () => {
    test("leaves short text alone and cuts long text to the limit with an ellipsis", () => {
        expect(clip("Files", 32)).toBe("Files");
        expect(clip("x".repeat(32), 32)).toBe("x".repeat(32));
        const long = clip("Sign in to X / X — Helium, a very long window title", 32);
        expect(long.length).toBeLessThanOrEqual(32);
        expect(long.endsWith("…")).toBe(true);
        expect(clip("abcd efgh", 6)).toBe("abcd…"); // no space before the ellipsis
    });
});
