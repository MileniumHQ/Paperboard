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
    preload: {},
    renderer: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/renderer/index.html"),
                    updater: resolve(__dirname, "src/renderer/updater.html"),
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
            dedupe: [
                "solid-js",
                "solid-js/web",
                "solid-js/store",
                "@solid-primitives/utils",
                "@solid-primitives/refs",
            ],
        },
        optimizeDeps: {
            exclude: ["paperui", "paperapi"],
        },
        plugins: [solid()],
    },
});
