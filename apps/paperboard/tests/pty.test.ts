// PTY backend contract (bun test): under Bun (the standalone crane) spawnPty
// must use the built-in Bun.Terminal and give the child a real tty. On Windows
// Bun.Terminal does not exist, so spawnPty takes the node-pty path and this
// test does not apply (nativePtyPrebuild.test.ts covers that binary).
import { describe, it, expect } from "bun:test";
import { spawnPty, getDefaultShell, nodePtyEntry } from "../papercrane/pty";

describe("spawnPty (Bun.Terminal backend)", () => {
    it("runs a shell with a tty and streams its output", async () => {
        if (process.platform === "win32") return;
        const pty = spawnPty(
            getDefaultShell(),
            80,
            24,
            process.cwd(),
            { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
        );
        let output = "";
        const done = new Promise<string>((resolve) => {
            pty.onData((data) => {
                output += data;
                // "42" is not in the typed command, so it proves the shell
                // actually executed under the pty instead of echoing input
                if (output.includes("42")) {
                    pty.kill();
                    resolve(output);
                }
            });
            pty.onExit(() => resolve(output));
            pty.write("expr 40 + 2\r");
        });
        const timer = setTimeout(() => pty.kill(), 8000);
        try {
            expect(await done).toContain("42");
        } finally {
            clearTimeout(timer);
            pty.kill();
        }
    }, 10_000);
});

// The compiled Windows crane bundles node-pty's JS, so a plain
// require("node-pty") succeeds and its native conpty.node then fails to load
// from inside the bundle on the first spawn: every terminal and temp pty on a
// Windows computer died with "Failed to load native module: conpty.node".
describe("nodePtyEntry", () => {
    const crane = "C:\\Users\\u\\usb\\crane\\papercrane-windows-x64.exe";
    const sidecar = "C:\\Users\\u\\usb\\crane\\node-pty\\lib\\index.js";

    it("loads the sidecar beside the compiled Windows crane", () => {
        expect(
            nodePtyEntry({ bun: true, platform: "win32", execPath: crane }, (f) => f === sidecar),
        ).toBe(sidecar);
    });

    it("refuses with the missing path instead of loading the bundled copy", () => {
        expect(() =>
            nodePtyEntry({ bun: true, platform: "win32", execPath: crane }, () => false),
        ).toThrow(/node-pty folder that ships beside papercrane-windows-x64\.exe/);
    });

    it("uses the installed node-pty under Node and Electron", () => {
        for (const platform of ["win32", "linux", "darwin"] as const) {
            expect(
                nodePtyEntry({ bun: false, platform, execPath: "/x/electron" }, () => true),
            ).toBe("node-pty");
        }
    });
});
