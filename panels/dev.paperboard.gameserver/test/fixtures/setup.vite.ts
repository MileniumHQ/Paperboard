import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Build with: ./node_modules/.bin/vite build --config test/fixtures/setup.vite.ts
// --outDir <temporary directory>, then serve that directory on loopback and
// open /test/fixtures/setup.html. The fixture reports PASS or FAIL in #result.
export default defineConfig({
    plugins: [solid()],
    resolve: { dedupe: ["solid-js", "solid-js/web", "solid-js/store"] },
    build: {
        target: "esnext",
        rollupOptions: { input: "test/fixtures/setup.html" },
    },
});
