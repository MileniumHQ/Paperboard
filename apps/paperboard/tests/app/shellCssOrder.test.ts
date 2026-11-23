// The shell's CSS modules override PaperUI's base rules at equal
// specificity, so PaperUI's stylesheet has to come first in the cascade
// (App.tsx imports both before anything else). When an entry loaded the
// shell's modules before PaperUI's stylesheet, PaperFlex's `position:
// relative` beat the frame layers' `position: absolute`, and the Panel
// Library and every panel rendered in the bottom half of the window. Builds the real renderer entry and reads
// the order out of the CSS it ships.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..", "..");

describe("the shell's stylesheet", () => {
    test("puts PaperUI's base rules before the shell's own", async () => {
        const dir = mkdtempSync(join(tmpdir(), "paperboard-shell-css-"));
        try {
            const { build } = await import("vite");
            const solidPlugin = (await import("vite-plugin-solid")).default;
            await build({
                root: join(appDir, "src", "renderer"),
                configFile: false,
                logLevel: "error",
                plugins: [solidPlugin()],
                resolve: {
                    alias: { "@renderer": join(appDir, "src", "renderer", "src") },
                    dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
                },
                build: {
                    outDir: dir,
                    emptyOutDir: true,
                    minify: false,
                    rollupOptions: { input: join(appDir, "src", "renderer", "index.html") },
                },
            });
            const assets = join(dir, "assets");
            const css = readdirSync(assets)
                .filter((name) => name.endsWith(".css"))
                .map((name) => readFileSync(join(assets, name), "utf8"))
                .join("\n");
            const paperFlex = css.search(/\._PaperFlex_\w+\s*\{/);
            const frameLayer = css.search(/\._frameLayer_\w+\s*\{/);
            expect(paperFlex).toBeGreaterThanOrEqual(0);
            expect(frameLayer).toBeGreaterThanOrEqual(0);
            expect(frameLayer).toBeGreaterThan(paperFlex);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);
});
