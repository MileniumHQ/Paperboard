import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { paperuiAlias } from "./vite.site.shared";

// Root-site client build: the hydration bundle and stylesheet for the
// prerendered pages. Output lands next to the docs build in dist/ without
// clearing it, under stable names the prerender script can link.
export default defineConfig({
    base: "/",
    // ssr: true here means "hydratable": the client pass must be compiled with
    // hydration support to attach to the SSR markup.
    plugins: [solid({ ssr: true })],
    resolve: { alias: paperuiAlias },
    build: {
        outDir: "dist",
        emptyOutDir: false,
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
