// What the phone's key row sends to the shell.
import { describe, expect, test } from "bun:test";
import { keyBytes, withModifiers, NO_MODIFIERS } from "../src/lib/softKeys";

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
