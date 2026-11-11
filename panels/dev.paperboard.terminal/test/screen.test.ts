// What the terminal decides on its own before anything reaches a shell or the
// system browser: which links open, and which pastes are asked about.
import { describe, expect, test } from "bun:test";
import { linkOpens, pasteLines, pasteRunsAtOnce } from "../src/lib/screen";

describe("links open in the system browser only when safe", () => {
    test("https anywhere, http only on this computer", () => {
        expect(linkOpens("https://example.com/a?b=c")).toBe(true);
        expect(linkOpens("http://localhost:5173/")).toBe(true);
        expect(linkOpens("http://app.localhost/")).toBe(true);
        expect(linkOpens("http://127.0.0.1:8080")).toBe(true);
        expect(linkOpens("http://[::1]:3000/")).toBe(true);
    });

    test("anything else stays in the terminal", () => {
        expect(linkOpens("http://example.com/")).toBe(false);
        // a host that only starts like a loopback one
        expect(linkOpens("http://localhost.example.com/")).toBe(false);
        expect(linkOpens("http://127.0.0.1.example.com/")).toBe(false);
        expect(linkOpens("file:///etc/passwd")).toBe(false);
        expect(linkOpens("javascript:alert(1)")).toBe(false);
        expect(linkOpens("ssh://host")).toBe(false);
        expect(linkOpens("not a url")).toBe(false);
    });
});

describe("a paste that would run commands is asked about first", () => {
    const prompt = { atPrompt: true, bracketedPaste: false };

    test("lines pasted at a prompt that runs each one at once", () => {
        expect(pasteRunsAtOnce("rm -rf build\nmake", prompt)).toBe(true);
        expect(pasteRunsAtOnce("one\r", prompt)).toBe(true);
    });

    test("a single line, a shell reading pastes whole, or a program's input is not asked about", () => {
        expect(pasteRunsAtOnce("echo hi", prompt)).toBe(false);
        expect(pasteRunsAtOnce("one\ntwo", { atPrompt: true, bracketedPaste: true })).toBe(false);
        // a command is running (or the shell never marked a prompt): the lines are its input
        expect(pasteRunsAtOnce("one\ntwo", { atPrompt: false, bracketedPaste: false })).toBe(false);
    });

    test("the question counts the lines that run", () => {
        expect(pasteLines("one\ntwo\nthree\n")).toBe(3);
        expect(pasteLines("one\r\ntwo")).toBe(2);
    });
});
