import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";
export default defineConfig({
    plugins: [solid()],
    optimizeDeps: { entries: ["test/fixtures/modrinth.html"] },
    resolve: {
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
        alias: [{ find: /^(\.\.\/lib\/server|\.\/server)$/, replacement: fileURLToPath(new URL("./modrinthServer.ts", import.meta.url)) }],
    },
    server: { host: "127.0.0.1" },
});
