// contenteditable input hygiene (bun test): number fields must never hold
// text that turns into NaN on blur; single-line action values must never
// receive a pasted newline, while multiline fields keep their line breaks.
import { describe, test, expect } from "bun:test";
import {
    plainTextFromClipboard,
    sanitizeNumberText,
} from "../src/lib/textInput";

describe("sanitizeNumberText", () => {
    test("keeps digits, one leading minus and one decimal point", () => {
        expect(sanitizeNumberText("123")).toBe("123");
        expect(sanitizeNumberText("-12.5")).toBe("-12.5");
        expect(sanitizeNumberText("1.2.3")).toBe("1.23");
        expect(sanitizeNumberText("1-2")).toBe("12");
    });

    test("strips letters, spaces and pasted units", () => {
        expect(sanitizeNumberText("42ms")).toBe("42");
        expect(sanitizeNumberText("1,000")).toBe("1000");
        expect(sanitizeNumberText("  -9  ")).toBe("-9");
    });

    test("a wiped field stays empty rather than becoming NaN text", () => {
        expect(sanitizeNumberText("abc")).toBe("");
    });
});

describe("plainTextFromClipboard", () => {
    test("collapses pasted newlines to spaces", () => {
        expect(plainTextFromClipboard("line one\nline two")).toBe(
            "line one line two",
        );
        expect(plainTextFromClipboard("a\n\nb")).toBe("a b");
    });

    test("multiline fields keep their line breaks and normalize CRLF", () => {
        expect(plainTextFromClipboard("line one\nline two", true)).toBe(
            "line one\nline two",
        );
        expect(plainTextFromClipboard("a\r\nb\rc", true)).toBe("a\nb\nc");
        expect(plainTextFromClipboard("  indented\n", true)).toBe("  indented\n");
    });

    test("missing clipboard data is empty, not an exception", () => {
        expect(plainTextFromClipboard(undefined)).toBe("");
        expect(plainTextFromClipboard(null)).toBe("");
        expect(plainTextFromClipboard(undefined, true)).toBe("");
    });
});
