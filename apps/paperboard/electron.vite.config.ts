import { resolve } from "path";
import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

export default defineConfig({
    main: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/main/index.ts"),
                },
            },
        },
    },
    preload: { build: { rollupOptions: { input: {
        index: resolve(__dirname, "src/preload/index.ts"),
        screenshot: resolve(__dirname, "src/preload/screenshot.ts"),
    } } } },
    renderer: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/renderer/index.html"),
                    updater: resolve(__dirname, "src/renderer/updater.html"),
                    screenshot: resolve(__dirname, "src/renderer/screenshot.html"),
                },
            },
        },
        server: {
            fs: {
                allow: [
                    "..",
                    resolve(__dirname, "../../packages/paperui"),
                    resolve(__dirname, "../../packages/paperapi"),
                ],
            },
        },
        resolve: {
            alias: {
                "@renderer": resolve(__dirname, "src/renderer/src"),
            },
            // The @solid-primitives packages are deliberately not deduped:
            // forcing resolution at the root picks up patched copies with no
            // dependency links, which breaks their own imports. They resolve
            // through solid-transition-group instead, where the store copies
            // and their linked dependencies live.
            dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
        },
        optimizeDeps: {
            exclude: ["paperui", "paperapi"],
        },
        plugins: [solid()],
    },
});
