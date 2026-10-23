import { describe, expect, test } from "bun:test";
import type { InputEvent } from "../src/contract";
import { enqueue, keyEvent } from "../src/computer/input";

const key = (k: string, m: Partial<{ ctrl: boolean; alt: boolean; meta: boolean; shift: boolean }> = {}) =>
    keyEvent({ key: k, ctrlKey: !!m.ctrl, altKey: !!m.alt, metaKey: !!m.meta, shiftKey: !!m.shift });

// the guest refuses any key name outside this
const GUEST_KEYS = /^[A-Za-z0-9_+]{1,64}$/;

describe("the user's keys", () => {
    test("characters are typed as written, named keys and chords become keysyms the guest accepts", () => {
        expect(key("a")).toEqual({ type: "text", text: "a" });
        expect(key("?", { shift: true })).toEqual({ type: "text", text: "?" });
        expect(key("é")).toEqual({ type: "text", text: "é" });
        expect(key("Enter")).toEqual({ type: "key", keys: "Return" });
        expect(key("Tab", { shift: true })).toEqual({ type: "key", keys: "shift+Tab" });
        expect(key("A", { ctrl: true, shift: true })).toEqual({ type: "key", keys: "ctrl+shift+a" });
        expect(key("-", { ctrl: true })).toEqual({ type: "key", keys: "ctrl+minus" });
        expect(key("F5")).toEqual({ type: "key", keys: "F5" });
        for (const k of ["Enter", "Backspace", "ArrowLeft", "PageDown", "F12", " ", "/", "`", "l"]) {
            const ev = key(k, { ctrl: true });
            expect(ev?.type === "key" && GUEST_KEYS.test(ev.keys)).toBe(true);
        }
    });

    test("lone modifiers and unknown keys send nothing", () => {
        expect(key("Shift", { shift: true })).toBeNull();
        expect(key("Control", { ctrl: true })).toBeNull();
        expect(key("Unidentified")).toBeNull();
        expect(key("§", { ctrl: true })).toBeNull();
    });
});

describe("a pending batch", () => {
    test("typing joins up, moves and scrolls coalesce, and it stays bounded", () => {
        const b: InputEvent[] = [];
        enqueue(b, { type: "text", text: "h" });
        enqueue(b, { type: "text", text: "i" });
        enqueue(b, { type: "move", x: 1, y: 1 });
        enqueue(b, { type: "move", x: 5, y: 5 });
        for (let i = 0; i < 30; i++) enqueue(b, { type: "scroll", x: 5, y: 5, dy: 1 });
        expect(b).toEqual([
            { type: "text", text: "hi" },
            { type: "move", x: 5, y: 5 },
            { type: "scroll", x: 5, y: 5, dy: 20, dx: 0 },
        ]);
        const full: InputEvent[] = [];
        for (let i = 0; i < 64; i++) enqueue(full, { type: "down", button: 1 }), enqueue(full, { type: "up", button: 1 });
        expect(full.length).toBe(64);
        expect(enqueue(full, { type: "key", keys: "Return" })).toBe(false);
    });
});
