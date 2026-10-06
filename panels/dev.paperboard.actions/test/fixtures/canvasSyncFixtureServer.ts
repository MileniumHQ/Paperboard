// Run with bun from the panel directory, then inspect
// http://127.0.0.1:5198/test/fixtures/canvasSyncFixture.html in the browser.
// window.canvasFixture exposes assertions for retry, notes, and test-run
// ordering against the real App and PaperUI. No daemon discovery is used.
import { createServer } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "node:path";

const panel = resolve(import.meta.dir, "../..");
const server = await createServer({
    root: panel,
    configFile: false,
    plugins: [solidPlugin()],
    resolve: {
        alias: [{ find: /^@mileniumhq\/paperapi$/, replacement: resolve(import.meta.dir, "canvasSyncApi.ts") }],
        dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
    },
    server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
console.log("Actions regression fixture: http://127.0.0.1:5198/test/fixtures/canvasSyncFixture.html");
