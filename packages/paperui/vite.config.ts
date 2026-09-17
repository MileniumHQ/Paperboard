import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import dts from "vite-plugin-dts";
import path from "path";

export default defineConfig({
    plugins: [
        solidPlugin(),
        dts({
            insertTypesEntry: true,
            tsconfigPath: "./tsconfig.json",
            rollupTypes: true,
            // tests are dev-only: their types and assets must never ship
            // inside the published package
            exclude: ["src/__tests__", "**/*.test.*"],
        }),
    ],
    build: {
        target: "esnext",
        cssCodeSplit: false,
        lib: {
            entry: path.resolve(__dirname, "src/index.ts"),
            name: "PaperUI",
            fileName: (format) => format === "es" ? "paperui.es.js" : "paperui.cjs",
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: [
                "solid-js",
                "solid-js/web",
                "solid-js/store",
                "solid-transition-group",
            ],
            output: {
                exports: "named",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css" || assetInfo.name?.endsWith(".css")) {
                        return "paperui.css";
                    }
                    return assetInfo.name || "";
                },
                globals: {
                    "solid-js": "Solid",
                    "solid-js/web": "SolidWeb",
                    "solid-js/store": "SolidStore",
                },
            },
        },
    },
});
