import { defineConfig } from "vite";
import { paperuiAlias } from "./vite.site.shared.ts";

// The marketing pages' element script (dist/js/marketing-elements.js): PaperUI
// Marketing's <marketing-text> and the outro's icon playground, as a classic
// script. The pages load it in their head, so every heading renders as the
// parser creates it instead of painting its plain words first. It runs after
// the client build, which clears dist/.
export default defineConfig({
    base: "/",
    publicDir: false,
    resolve: { alias: paperuiAlias },
    build: {
        outDir: "dist/js",
        emptyOutDir: false,
        target: "es2022",
        lib: {
            entry: "src/site/marketingElements.ts",
            formats: ["iife"],
            name: "PaperboardMarketing",
            fileName: () => "marketing-elements.js",
        },
    },
});
