import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import dts from "vite-plugin-dts";
import path from "path";
import { writeFileSync } from "fs";

// PaperUI Marketing builds on its own, after the main library, into the same
// dist: its own script (marketing.es.js), its framework-free elements
// (marketing-elements.es.js) and its own stylesheet (marketing.css), so a page
// of the app never carries the site's look and the site never needs the app's
// components.
export default defineConfig({
    base: "./",
    plugins: [
        solidPlugin(),
        dts({
            tsconfigPath: "./tsconfig.json",
            entryRoot: "src",
            include: ["src/marketing", "src/utils/cx.ts", "src/utils/style.ts"],
            // one entry file for the subpath export, over the per-file types
            afterBuild: () => {
                writeFileSync(path.resolve(import.meta.dirname, "dist/marketing.d.ts"), 'export * from "./marketing/index";\n');
                writeFileSync(path.resolve(import.meta.dirname, "dist/marketing-elements.d.ts"), 'export * from "./marketing/elements/index";\n');
            },
        }),
    ],
    build: {
        target: "esnext",
        cssCodeSplit: false,
        emptyOutDir: false,
        lib: {
            entry: {
                marketing: path.resolve(import.meta.dirname, "src/marketing/index.ts"),
                "marketing-elements": path.resolve(import.meta.dirname, "src/marketing/elements/index.ts"),
            },
            fileName: (format, entry) => `${entry}.${format === "es" ? "es.js" : "cjs"}`,
            formats: ["es", "cjs"],
        },
        rollupOptions: {
            external: ["solid-js", "solid-js/web", "solid-js/store"],
            output: {
                exports: "named",
                assetFileNames: (assetInfo) => (assetInfo.name?.endsWith(".css") ? "marketing.css" : assetInfo.name || ""),
            },
        },
    },
});
