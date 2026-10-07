// terminal keyboard policy (bun test): copy is taken over, paste must be left
// to the browser's native paste event so xterm can insert the clipboard.
import { describe, it, expect } from "bun:test";
import { terminalKeyAction, type TerminalKeyEvent } from "../src/keys";

const key = (over: Partial<TerminalKeyEvent>): TerminalKeyEvent => ({
    type: "keydown",
    code: "KeyC",
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    ...over,
});

describe("terminal key policy", () => {
    it("takes over copy", () => {
        expect(terminalKeyAction(key({ ctrlKey: true, shiftKey: true }))).toBe("copy");
        expect(terminalKeyAction(key({ metaKey: true }))).toBe("copy");
    });

    it("leaves Ctrl+C to the shell as SIGINT", () => {
        expect(terminalKeyAction(key({ ctrlKey: true }))).toBeNull();
    });

    it("leaves every paste shortcut to the native paste event", () => {
        expect(terminalKeyAction(key({ code: "KeyV", ctrlKey: true }))).toBeNull();
        expect(terminalKeyAction(key({ code: "KeyV", ctrlKey: true, shiftKey: true }))).toBeNull();
        expect(terminalKeyAction(key({ code: "KeyV", metaKey: true }))).toBeNull();
        expect(terminalKeyAction(key({ code: "KeyV", metaKey: true, shiftKey: true }))).toBeNull();
    });

    it("ignores non-keydown events", () => {
        expect(terminalKeyAction(key({ type: "keyup", ctrlKey: true, shiftKey: true }))).toBeNull();
        expect(terminalKeyAction(key({ type: "keypress", ctrlKey: true, shiftKey: true }))).toBeNull();
    });
});
