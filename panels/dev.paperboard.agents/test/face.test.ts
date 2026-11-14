import { describe, expect, test } from "bun:test";
import { BLINK_MS, blinkSince, frameSeconds } from "../src/face/blink";

describe("the face's frame clock", () => {
    test("a frame that began before the clock read that woke it still counts as the blink's first", () => {
        const blinkAt = 1000;
        // the frame's timestamp is up to a frame earlier than performance.now() was
        expect(blinkSince(985, blinkAt)).toBe(0);
        expect(blinkSince(1000, blinkAt)).toBe(0);
        expect(blinkSince(1000 + BLINK_MS / 2, blinkAt)).toBe(BLINK_MS / 2);
    });

    test("a blink ends, so the loop can rest, and one never asked for is not a blink", () => {
        expect(blinkSince(1000 + BLINK_MS, 1000)).toBeNull();
        expect(blinkSince(5000, 1000)).toBeNull();
        expect(blinkSince(5000, -Infinity)).toBeNull();
    });

    test("a frame never advances backwards or by more than a hiccup", () => {
        expect(frameSeconds(985, 1000)).toBe(0);
        expect(frameSeconds(1016, 1000)).toBeCloseTo(0.016);
        expect(frameSeconds(9000, 1000)).toBe(0.05);
    });
});
