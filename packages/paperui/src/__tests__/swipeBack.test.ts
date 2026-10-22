// Phone layouts' back swipe: a page goes back when dragged right far enough
// or flicked right, never on a tap, a leftward drag, or a slow nudge.
import { describe, test, expect } from "vitest";
import { SWIPE_FLICK, SWIPE_SLOP, swipeGoesBack } from "../utils/swipeBack";

const WIDTH = 402; // iPhone 16 Pro

describe("swipe back", () => {
    test("goes back past a third of the page, or on a flick", () => {
        expect(swipeGoesBack(WIDTH * 0.5, 0, WIDTH)).toBe(true);
        expect(swipeGoesBack(40, SWIPE_FLICK, WIDTH)).toBe(true);
    });

    test("stays on a tap, a leftward drag, or a slow short drag", () => {
        expect(swipeGoesBack(SWIPE_SLOP, 5, WIDTH)).toBe(false);
        expect(swipeGoesBack(-200, 5, WIDTH)).toBe(false);
        expect(swipeGoesBack(60, 0.1, WIDTH)).toBe(false);
    });
});
