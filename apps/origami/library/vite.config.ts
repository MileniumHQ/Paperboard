import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { REGISTRY_ORIGIN } from "../src/downloadUrl";

// The library is served by Origami at /library/ and reads the registry from
// its own origin (same-origin /panels/index.json and /panel/:id/download).
// The dev server proxies those two route families to an Origami instance so
// the page exercises the exact production URL shape.
const ORIGAMI_URL = process.env.ORIGAMI_URL || REGISTRY_ORIGIN;

export default defineConfig({
    base: "/library/",
    plugins: [solid()],
    build: {
        // Output lands at dist/library/* so Cloudflare static assets can
        // serve the whole directory under the /library/ prefix.
        outDir: "dist/library",
        emptyOutDir: true,
        target: "esnext",
    },
    server: {
        port: 5175,
        proxy: {
            "/panels": { target: ORIGAMI_URL, changeOrigin: true },
            "/panel": { target: ORIGAMI_URL, changeOrigin: true },
        },
    },
});
