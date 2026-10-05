import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("screenshot controller uses the existing Electron window and saves native/scaled PNGs", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperboard-screenshot-test-"));
    try {
        await mkdir(join(root, "main"));
        await mkdir(join(root, "preload"));
        for (const [entry, outfile] of [
            [resolve(import.meta.dir, "fixtures/screenshotTool.electron.ts"), join(root, "main/fixture.js")],
            [resolve(import.meta.dir, "../src/preload/screenshot.ts"), join(root, "preload/screenshot.js")],
        ]) {
            const result = await Bun.build({ entrypoints: [entry!], target: "node", format: "cjs", external: ["electron"], outdir: root, naming: outfile!.slice(root.length + 1) });
            expect(result.success).toBe(true);
            // Bun folds __dirname to source paths; Electron's bundled main
            // resolves preloads relative to the emitted main file instead.
            await writeFile(outfile!, (await result.outputs[0]!.text()).replace(/var __dirname = "[^"]*";/g, 'var __dirname = require("node:path").dirname(__filename);'));
        }
        const env = { ...process.env, PAPERBOARD_DIR: root };
        delete env.ELECTRON_RUN_AS_NODE;
        // Other daemon tests mock the electron module. Resolve its installed
        // executable directly so this test always crosses the real boundary.
        const electronDir = dirname(require.resolve("electron/package.json"));
        const electron = join(electronDir, "dist", (await readFile(join(electronDir, "path.txt"), "utf8")).trim());
        const { stdout } = await promisify(execFile)(electron, [join(root, "main/fixture.js")], { env, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
        expect(stdout).toContain("SCREENSHOT_CONTRACT_PASS");
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 40_000);
