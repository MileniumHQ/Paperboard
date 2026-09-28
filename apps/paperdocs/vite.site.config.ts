import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { paperuiAlias } from "./vite.site.shared";

// Root-site prerender build. The docs SPA keeps vite.config.ts (base "/docs/").
// This SSR pass renders the root pages to static HTML into dist/ via
// scripts/prerender-site.mjs. The client pass (vite.site.client.config.ts)
// emits site-client.js and site.css, which the prerendered pages link.
export default defineConfig({
    base: "/",
    plugins: [solid({ ssr: true })],
    resolve: { alias: paperuiAlias },
    build: {
        ssr: "src/site/entry-server.tsx",
        outDir: "dist-ssr",
        emptyOutDir: true,
        // The SSR module graph contains every component the pages use, so its
        // stylesheet is the complete one the browser links. The client build
        // emits its own (chrome-only) CSS, which the prerender script
        // overwrites with this one.
        ssrEmitAssets: true,
        target: "esnext",
        rollupOptions: {
            output: {
                assetFileNames: (assetInfo) =>
                    assetInfo.name?.endsWith(".css")
                        ? "site.css"
                        : "assets/[name]-[hash][extname]",
            },
        },
    },
    ssr: {
        noExternal: true,
    },
});
