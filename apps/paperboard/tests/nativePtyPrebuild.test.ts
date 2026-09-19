// node-pty prebuilt binary contract (bun test): the Electron main process has
// no globalThis.Bun, so papercrane/pty.ts takes its node-pty backend. node-pty
// 1.1.0 shipped no linux prebuild, so Electron terminals could not start at
// all on Linux. This fails without the fix because the host platform's
// pty.node is absent.
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SUPPORTED = new Set([
    "darwin-x64",
    "darwin-arm64",
    "linux-x64",
    "linux-arm64",
    "win32-x64",
    "win32-arm64",
]);

describe("node-pty prebuilt binary", () => {
    it("ships a pty.node for the host platform", () => {
        const platform = `${process.platform}-${process.arch}`;
        expect(SUPPORTED.has(platform), `unsupported platform ${platform}`).toBe(true);
        const packageDir = path.dirname(require.resolve("node-pty/package.json"));
        const binary = path.join(packageDir, "prebuilds", platform, "pty.node");
        expect(fs.existsSync(binary), `missing ${binary}`).toBe(true);
    });
});
