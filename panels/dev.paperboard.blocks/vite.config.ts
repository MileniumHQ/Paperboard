import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solidPlugin from "vite-plugin-solid";

/** Blockly's sprites, cursors and sounds, bundled so it never loads them from its CDN. */
function blocklyMedia(): Plugin {
    const media = join(dirname(createRequire(import.meta.url).resolve("blockly")), "media");
    return {
        name: "blockly-media",
        generateBundle() {
            for (const file of readdirSync(media)) {
                this.emitFile({ type: "asset", fileName: `blockly-media/${file}`, source: readFileSync(join(media, file)) });
            }
        },
    };
}

export default defineConfig({
    plugins: [solidPlugin(), blocklyMedia()],
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
});
