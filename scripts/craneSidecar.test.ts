import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { writeNodePtySidecar } from "./craneSidecar";

test("the Windows crane sidecar packages the installed node-pty dependency", () => {
    const require = createRequire(new URL("../apps/paperboard/package.json", import.meta.url));
    const dependency = dirname(require.resolve("node-pty/package.json"));
    const root = mkdtempSync(join(tmpdir(), "crane-sidecar-"));
    try {
        writeNodePtySidecar(root, dependency);
        expect(existsSync(join(root, "node-pty", "lib", "index.js"))).toBe(true);
        expect(existsSync(join(root, "node-pty", "prebuilds", "win32-x64", "conpty.node"))).toBe(true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
