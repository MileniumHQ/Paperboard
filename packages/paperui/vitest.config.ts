import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    test: {
        environment: "jsdom",
        globals: true,
        isolate: true,
        // one Solid runtime: vite-plugin-solid inlines solid-js and the packages
        // that import it, but not the ones those import in turn
        // (solid-transition-group's @solid-primitives), which would load a second
        server: { deps: { inline: [/@solid-primitives/, /solid-transition-group/] } },
    },
    resolve: {
        // solid-js resolves browser/development builds through package.json
        // export conditions; the deps.optimizer/transformMode options used
        // previously are removed (deprecated in vitest 3+).
        conditions: ["development", "browser"],
    },
});
