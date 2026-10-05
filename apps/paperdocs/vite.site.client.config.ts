import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { docsSearchPlugin } from "./vite-plugin-docs-search";
import { paperuiAlias } from "./vite.site.shared";

// Browser bundle for the prerendered pages: the interactive islands (site
// topbar, contact form) and the docs app, plus their stylesheet. Output lands
// in dist/ under stable names the prerender script links; it is the first
// build, so it clears dist/ and copies public/ (including the landing) in.
export default defineConfig({
    base: "/",
    // ssr: true here means "compiled for the same markup the server produced":
    // the docs app and the islands render client-side, but the components must
    // match the server build.
    plugins: [docsSearchPlugin(), solid({ ssr: true })],
    resolve: { alias: paperuiAlias },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        target: "esnext",
        cssCodeSplit: false,
        lib: {
            entry: "src/site/entry-client.tsx",
            formats: ["es"],
            fileName: () => "site-client.js",
            name: "SiteClient",
        },
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) =>
                    assetInfo.name?.endsWith(".css")
                        ? "site.css"
                        : "assets/[name]-[hash][extname]",
            },
        },
    },
});

