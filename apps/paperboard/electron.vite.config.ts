import { resolve } from "path";
import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

// Main and the preload take only the SDK's shapes from its root, which the
// shell's contract (src/shared/shellContract.ts) and the types it names are
// written in: the rest of the root, which runs code as it loads, never
// enters them.
const sdkShapesOnly = { alias: [{ find: /^@mileniumhq\/paperapi$/, replacement: resolve(__dirname, "../../packages/paperapi/src/shape.ts") }] };

export default defineConfig({
    main: {
        resolve: sdkShapesOnly,
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
    preload: {
        resolve: sdkShapesOnly,
        build: {
            // a sandboxed preload can't require a package: what it takes is bundled
            externalizeDeps: { exclude: ["@mileniumhq/paperapi"] },
            rollupOptions: { input: {
                index: resolve(__dirname, "src/preload/index.ts"),
                screenshot: resolve(__dirname, "src/preload/screenshot.ts"),
            } },
        },
    },
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
