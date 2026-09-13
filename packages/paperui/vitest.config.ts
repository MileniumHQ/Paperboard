import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    test: {
        environment: "jsdom",
        globals: true,
        isolate: true,
    },
    resolve: {
        // solid-js resolves browser/development builds through package.json
        // export conditions; the deps.optimizer/transformMode options used
        // previously are removed (deprecated in vitest 3+).
        conditions: ["development", "browser"],
    },
});
