import { describe, expect, test } from "bun:test";
import { parseScrollback, type Scrollback } from "../src/lib/scrollback";

// A shell's output is kept in runs by the size its screen was, so a screen
// shown again replays each at its size.
describe("a scrollback's sizes", () => {
    test("is saved and read back as it was, and a file that isn't one is refused", () => {
        const screen: Scrollback = [{ text: "from before sizes" }, { cols: 80, rows: 24, text: "now" }];
        expect(parseScrollback(JSON.stringify(screen))).toEqual(screen);
        expect(() => parseScrollback("plain text")).toThrow();
        expect(() => parseScrollback(JSON.stringify([{ cols: 80, text: "half a size" }]))).toThrow("isn't a saved screen");
    });
});
