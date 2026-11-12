// What the phone's key row sends to the shell, and how far the on-screen
// keyboard reaches up the panel.
import { describe, expect, test } from "bun:test";
import { keyBytes, withModifiers, NO_MODIFIERS } from "../src/lib/softKeys";
import { keyboardInsetOf, type ViewportFrame } from "../src/lib/keyboardInset";

describe("keys the key row sends", () => {
    test("the cursor keys follow the program's cursor mode", () => {
        expect(keyBytes("up", false)).toBe("\x1b[A");
        expect(keyBytes("left", false)).toBe("\x1b[D");
        expect(keyBytes("up", true)).toBe("\x1bOA");
        expect(keyBytes("end", true)).toBe("\x1bOF");
    });

    test("a modifier makes the long form, whatever the cursor mode", () => {
        expect(keyBytes("right", true, { ctrl: true, alt: false })).toBe("\x1b[1;5C");
        expect(keyBytes("left", false, { ctrl: false, alt: true })).toBe("\x1b[1;3D");
        expect(keyBytes("up", false, { ctrl: true, alt: true })).toBe("\x1b[1;7A");
        expect(keyBytes("pageDown", false)).toBe("\x1b[6~");
        expect(keyBytes("pageUp", false, { ctrl: true, alt: false })).toBe("\x1b[5;5~");
    });

    test("escape and tab", () => {
        expect(keyBytes("esc", false)).toBe("\x1b");
        expect(keyBytes("tab", false)).toBe("\t");
        expect(keyBytes("tab", false, { ctrl: false, alt: true })).toBe("\x1b\t");
    });
});

describe("latched Ctrl and Alt", () => {
    test("Ctrl turns a letter into its control character", () => {
        expect(withModifiers("c", { ctrl: true, alt: false })).toEqual({ data: "\x03", consumed: true });
        expect(withModifiers("D", { ctrl: true, alt: false })).toEqual({ data: "\x04", consumed: true });
        expect(withModifiers("[", { ctrl: true, alt: false })).toEqual({ data: "\x1b", consumed: true });
    });

    test("Alt sends escape first, and both stack", () => {
        expect(withModifiers("b", { ctrl: false, alt: true })).toEqual({ data: "\x1bb", consumed: true });
        expect(withModifiers("b", { ctrl: true, alt: true })).toEqual({ data: "\x1b\x02", consumed: true });
    });

    test("a character with no control code is only itself under Ctrl", () => {
        expect(withModifiers("5", { ctrl: true, alt: false })).toEqual({ data: "5", consumed: true });
    });

    test("nothing but one printable character takes a modifier, and the latch stays for the next key", () => {
        const latched = { ctrl: true, alt: false };
        for (const data of ["paste of words", "\x1b[A", "\r", "\x03", "\x7f", ""]) {
            expect(withModifiers(data, latched)).toEqual({ data, consumed: false });
        }
        expect(withModifiers("c", NO_MODIFIERS)).toEqual({ data: "c", consumed: false });
    });
});

// a window of a given height whose parent is `above`, placed `top` px down it
function frame(height: number, visualBottom: number | null, above?: { top: number; frame: ViewportFrame }): ViewportFrame {
    return { height, visualBottom, parent: () => above ?? null };
}

describe("how far the keyboard covers the panel", () => {
    test("a panel in the shell: the shell's visual viewport ends where the keyboard starts", () => {
        // the shell is 800 tall with a 300 keyboard; the panel starts 54 down it and is 746 tall
        const shell = frame(800, 500);
        expect(keyboardInsetOf(frame(746, 746, { top: 54, frame: shell }))).toBe(300);
    });

    test("no keyboard is no inset", () => {
        const shell = frame(800, 800);
        expect(keyboardInsetOf(frame(746, 746, { top: 54, frame: shell }))).toBe(0);
        // a panel that ends above the keyboard isn't covered
        expect(keyboardInsetOf(frame(300, 300, { top: 0, frame: frame(800, 500) }))).toBe(0);
    });

    test("a window with no visual viewport reads as no keyboard", () => {
        expect(keyboardInsetOf(frame(700, null))).toBe(0);
    });

    test("a parent of another origin leaves the panel's own viewport to answer", () => {
        const crossOrigin: ViewportFrame = {
            height: 700,
            visualBottom: 400,
            parent: () => {
                throw new DOMException("blocked", "SecurityError");
            },
        };
        expect(keyboardInsetOf(crossOrigin)).toBe(300);
    });

    test("any other failure is not hidden", () => {
        const broken: ViewportFrame = {
            height: 700,
            visualBottom: 400,
            parent: () => {
                throw new Error("boom");
            },
        };
        expect(() => keyboardInsetOf(broken)).toThrow("boom");
    });
});
