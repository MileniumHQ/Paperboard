import { describe, expect, test } from "bun:test";
import { TAB_TITLE_CHARS, shortTitle } from "../src/lib/tabs";

describe("shortTitle", () => {
    test("a title that fits stays, and a longer one is cut to the tab's width with an ellipsis", () => {
        expect(shortTitle("bash")).toBe("bash");
        const long = "a-very-long-tab-name-that-would-make-a-tab-as-wide-as-the-screen";
        const short = shortTitle(long);
        expect([...short]).toHaveLength(TAB_TITLE_CHARS);
        expect(short.endsWith("…")).toBe(true);
        expect(long.startsWith(short.slice(0, -1))).toBe(true);
    });
});
