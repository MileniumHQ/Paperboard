import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
    plugins: [solidPlugin()],
    test: {
        environment: "jsdom",
        globals: true,
        isolate: true,
        // builds and serves the fixture page the Chrome suites in test/browser drive
        globalSetup: ["./test/browser/support/globalSetup.ts"],
        // a Chrome suite launches a browser per file and waits on real frames
        hookTimeout: 60_000,
        testTimeout: 30_000,
    },
    resolve: {
        // solid-js resolves browser/development builds through package.json
        // export conditions; the deps.optimizer/transformMode options used
        // previously are removed (deprecated in vitest 3+).
        conditions: ["development", "browser"],
    },
});
