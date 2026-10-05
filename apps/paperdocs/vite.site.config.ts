import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { docsSearchPlugin } from "./vite-plugin-docs-search";
import { paperuiAlias } from "./vite.site.shared";

// Site SSR build for every prerendered page: the root pages and the docs
// pages share this one entry. The client pass (vite.site.client.config.ts)
// emits site-client.js and site.css; scripts/prerender-site.mjs turns the SSR
// output into static documents. public/ is copied by the client build, so this
// pass only carries the SSR module graph.
export default defineConfig({
    base: "/",
    plugins: [docsSearchPlugin(), solid({ ssr: true })],
    publicDir: false,
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

