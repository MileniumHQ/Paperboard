// platform shell resolution (bun test): one-shot commands must run through
// cmd.exe on Windows and sh elsewhere — hardcoding sh breaks every win32 host
import { describe, it, expect } from "bun:test";
import { resolveOneShotShell } from "../src/service";

describe("resolveOneShotShell", () => {
    it("resolves cmd.exe with /d /s /c on win32", () => {
        expect(resolveOneShotShell("win32")).toEqual({
            command: "cmd.exe",
            baseArgs: ["/d", "/s", "/c"],
        });
    });

    it("resolves sh with -c on posix platforms", () => {
        expect(resolveOneShotShell("linux")).toEqual({
            command: "sh",
            baseArgs: ["-c"],
        });
        expect(resolveOneShotShell("darwin")).toEqual({
            command: "sh",
            baseArgs: ["-c"],
        });
    });

    it("defaults to the host platform", () => {
        const shell = resolveOneShotShell();
        if (process.platform === "win32") {
            expect(shell.command).toBe("cmd.exe");
        } else {
            expect(shell.command).toBe("sh");
        }
    });
});
