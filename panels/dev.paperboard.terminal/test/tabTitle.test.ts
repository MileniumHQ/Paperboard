import { describe, expect, test } from "bun:test";
import { TAB_TITLE_CHARS, shortTitle, shownFolder } from "../src/lib/tabs";

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

describe("shownFolder", () => {
    test("a folder in the home folder shows from ~; one that only starts with its name, or outside it, shows whole", () => {
        expect(shownFolder("/home/ada", "/home/ada")).toBe("~");
        expect(shownFolder("/home/ada/logs", "/home/ada")).toBe("~/logs");
        expect(shownFolder("C:\\Users\\ada\\logs", "C:\\Users\\ada")).toBe("~\\logs");
        expect(shownFolder("/home/adam", "/home/ada")).toBe("/home/adam");
        expect(shownFolder("/srv", "/home/ada")).toBe("/srv");
        expect(shownFolder("/srv", "")).toBe("/srv");
    });
});
