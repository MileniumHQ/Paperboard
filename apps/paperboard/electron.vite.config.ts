import { resolve } from "path";
import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

export default defineConfig({
    main: {
        build: {
            // the SDK and design system ship TypeScript and CSS sources the
            // main process takes pieces of: bundled, never required at runtime
            externalizeDeps: { exclude: ["@mileniumhq/paperapi", "@mileniumhq/paperui"] },
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
                    screenshot: resolve(__dirname, "src/renderer/screenshot.html"),
                    "signed-out": resolve(__dirname, "src/renderer/signed-out.html"),
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
            dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
        },
        optimizeDeps: {
            exclude: ["paperui", "paperapi"],
        },
        plugins: [solid()],
    },
});
