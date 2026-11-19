import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
    plugins: [solid()],
    test: {
        environment: "jsdom",
        globals: true,
        isolate: true,
    },
    resolve: {
        // solid-js resolves browser/development builds through package.json
        // export conditions (same as PaperUI's suite).
        conditions: ["development", "browser"],
    },
});
