import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
// the service runs one-shot commands with PaperAPI's resolver (src/service.ts)
import { resolveOneShotShell } from "@mileniumhq/paperapi";

// what Run Shell Command and a saved command's run hand the daemon: the
// shell, then its arguments, with the user's command as one argument
function runOneShot(command: string) {
    const shell = resolveOneShotShell();
    const ran = spawnSync(shell.command, [...shell.baseArgs, command], { encoding: "utf8" });
    if (ran.error) throw ran.error;
    return { status: ran.status, lines: ran.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) };
}

// One-shot shell per platform.
describe("one-shot shell per platform", () => {
    if (process.platform === "win32") {
        test("Windows runs one-shot commands through cmd.exe /d /s /c", () => {
            expect(resolveOneShotShell()).toEqual({ command: "cmd.exe", baseArgs: ["/d", "/s", "/c"] });
        });
    } else {
        test(`${process.platform} runs one-shot commands through sh -c`, () => {
            expect(resolveOneShotShell()).toEqual({ command: "sh", baseArgs: ["-c"] });
        });
    }

    test("a command with spaces and an operator runs as one command line and reports its exit", () => {
        expect(runOneShot("echo one-shot&& echo second")).toEqual({ status: 0, lines: ["one-shot", "second"] });
        expect(runOneShot("exit 3").status).toBe(3);
    });
});
