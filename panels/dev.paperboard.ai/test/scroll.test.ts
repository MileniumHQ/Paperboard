import { describe, expect, it } from "bun:test";
import { AT_BOTTOM_PX, isAtBottom, pinnedAfterScroll } from "../src/core/scroll";

const at = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });

describe("chat stick-to-bottom", () => {
    it("counts the last few pixels as the bottom", () => {
        expect(isAtBottom(at(600))).toBe(true);
        expect(isAtBottom(at(600 - AT_BOTTOM_PX))).toBe(true);
        expect(isAtBottom(at(600 - AT_BOTTOM_PX - 1))).toBe(false);
    });

    it("a scroll up lets go; reaching the bottom pins again", () => {
        expect(pinnedAfterScroll(true, 600, at(300))).toBe(false);
        expect(pinnedAfterScroll(false, 300, at(450))).toBe(false);
        expect(pinnedAfterScroll(false, 450, at(590))).toBe(true);
    });

    it("content growing under a pinned view does not let go", () => {
        // a tool card landed: the bottom moved 300px away while the reader stayed put,
        // and the browser nudged the view down to keep what was on screen in place
        expect(pinnedAfterScroll(true, 600, at(620, 1300))).toBe(true);
        expect(pinnedAfterScroll(true, 600, at(600, 1300))).toBe(true);
    });
});
