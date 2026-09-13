// Log file helpers (bun test): the name boundary and text tailing are the
// parts of the Logs tab that must not be wrong.
import { describe, test, expect } from "bun:test";
import { isLogFileName, logLabel, tailChars } from "../src/core/logs";

describe("isLogFileName", () => {
    test("accepts plain and gzipped log names", () => {
        expect(isLogFileName("latest.log")).toBe(true);
        expect(isLogFileName("2026-09-13-8.log.gz")).toBe(true);
        expect(isLogFileName("server.log")).toBe(true);
    });

    test("refuses paths, traversal, and other extensions", () => {
        for (const bad of [
            "../secret.log",
            "a/b.log",
            "a\\b.log",
            "log.old",
            "notes.txt",
            "",
            "..",
            "a..b.log",
            undefined,
            null,
            42,
        ]) {
            expect(isLogFileName(bad)).toBe(false);
        }
    });
});

describe("tailChars", () => {
    test("keeps the end of long text and flags truncation", () => {
        expect(tailChars("abcdef", 3)).toEqual({ text: "def", truncated: true });
        expect(tailChars("abc", 10)).toEqual({ text: "abc", truncated: false });
        expect(tailChars("abc", 0)).toEqual({ text: "", truncated: true });
    });
});

describe("logLabel", () => {
    test("names the current session and dates archives", () => {
        expect(logLabel("latest.log", Date.now())).toBe("Current session");
        // constructed from local components so the assertion is timezone-safe
        const ts = new Date(2026, 8, 13, 3, 3).getTime();
        expect(logLabel("2026-09-13-8.log.gz", ts)).toBe("Sep 13, 2026 · 03:03");
    });
});
