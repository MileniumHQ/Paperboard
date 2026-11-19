import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { MAX_DRAG, REPLY_AT, createSwipeReply, dragOffset } from "../src/chat/swipeReply";

describe("swiping a bubble to reply", () => {
    test("it follows the finger up to the reply point, then slows, and never goes past its limit", () => {
        expect(dragOffset(-20)).toBe(0);
        expect(dragOffset(30)).toBe(30);
        expect(dragOffset(REPLY_AT)).toBe(REPLY_AT);
        expect(dragOffset(REPLY_AT + 30)).toBe(REPLY_AT + 10);
        expect(dragOffset(1000)).toBe(MAX_DRAG);
    });
});

describe("the gesture", () => {
    const pointer = (type: string, x: number, y = 0, pointerType = "touch") => ({ type, pointerId: 1, isPrimary: true, pointerType, clientX: x, clientY: y }) as unknown as PointerEvent;

    function swipe(toward: 1 | -1) {
        const log: string[] = [];
        const s = createRoot(() => createSwipeReply({ toward: () => toward, enabled: () => true, onArm: () => log.push("buzz"), onReply: () => log.push("reply") }));
        return { s, log };
    }

    test("a finger dragged toward the middle past the reply point buzzes once, and letting go replies", () => {
        const { s, log } = swipe(-1); // the user's own bubble, on the right
        s.handlers.onPointerDown(pointer("pointerdown", 300));
        s.handlers.onPointerMove(pointer("pointermove", 280));
        expect(s.active()).toBe(true);
        expect(s.offset()).toBe(-20);
        s.handlers.onPointerMove(pointer("pointermove", 300 - REPLY_AT - 10));
        s.handlers.onPointerMove(pointer("pointermove", 300 - REPLY_AT - 30));
        expect(log).toEqual(["buzz"]);
        expect(s.progress()).toBe(1);
        s.handlers.onPointerUp(pointer("pointerup", 300 - REPLY_AT - 30));
        expect(log).toEqual(["buzz", "reply"]);
        expect(s.offset()).toBe(0);
        expect(s.active()).toBe(false);
    });

    test("short of the reply point, away from the middle, mostly vertical, or a mouse: no reply", () => {
        const short = swipe(1);
        short.s.handlers.onPointerDown(pointer("pointerdown", 0));
        short.s.handlers.onPointerMove(pointer("pointermove", REPLY_AT - 5));
        short.s.handlers.onPointerUp(pointer("pointerup", REPLY_AT - 5));
        expect(short.log).toEqual([]);

        const away = swipe(1);
        away.s.handlers.onPointerDown(pointer("pointerdown", 100));
        away.s.handlers.onPointerMove(pointer("pointermove", 20));
        away.s.handlers.onPointerMove(pointer("pointermove", 100 + REPLY_AT * 2));
        away.s.handlers.onPointerUp(pointer("pointerup", 100 + REPLY_AT * 2));
        expect(away.log).toEqual([]);

        const scroll = swipe(1);
        scroll.s.handlers.onPointerDown(pointer("pointerdown", 0, 0));
        scroll.s.handlers.onPointerMove(pointer("pointermove", 10, 40));
        scroll.s.handlers.onPointerMove(pointer("pointermove", REPLY_AT * 2, 40));
        scroll.s.handlers.onPointerUp(pointer("pointerup", REPLY_AT * 2, 40));
        expect(scroll.log).toEqual([]);

        const mouse = swipe(1);
        mouse.s.handlers.onPointerDown(pointer("pointerdown", 0, 0, "mouse"));
        mouse.s.handlers.onPointerMove(pointer("pointermove", REPLY_AT * 2, 0, "mouse"));
        mouse.s.handlers.onPointerUp(pointer("pointerup", REPLY_AT * 2, 0, "mouse"));
        expect(mouse.log).toEqual([]);
    });
});
