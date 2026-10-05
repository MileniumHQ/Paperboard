// Run: node scripts/preview-dmg-background.mjs
// Export / at 540x380 and /?scale=2 at 1080x760 with browser device scale 1,
// after Nunito, Material Symbols Rounded, and the styled-text SVG are ready.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const docsRoot = fileURLToPath(new URL("../apps/paperdocs/", import.meta.url));
const backgroundRoot = fileURLToPath(new URL("../apps/paperboard/build/", import.meta.url));
const docsRequire = createRequire(`${docsRoot}/package.json`);
const { createServer: createViteServer } = await import(new URL("./dist/node/index.js", pathToFileURL(docsRequire.resolve("vite/package.json"))).href);
const { default: solid } = await import(new URL("../esm/index.mjs", pathToFileURL(docsRequire.resolve("vite-plugin-solid"))).href);
const vite = await createViteServer({
    configFile: false,
    root: docsRoot,
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: false, fs: { allow: [repoRoot] } },
    ssr: { noExternal: true },
});
let server;
try {
    const { renderBackground } = await vite.ssrLoadModule(`${backgroundRoot}/background.tsx`);
    const template = await readFile(`${backgroundRoot}/background.html`, "utf8");
    const html = template
        .replaceAll("{{paperuiRoot}}", `/@fs${repoRoot}packages/paperui/src`)
        .replace("<!--dmg-body-->", renderBackground());
    server = createServer((request, response) => {
        if (new URL(request.url ?? "/", "http://localhost").pathname === "/") {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(html);
            return;
        }
        vite.middlewares(request, response, () => {
            response.writeHead(404);
            response.end("Not found");
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(8791, "127.0.0.1", resolve);
    });
} catch (error) {
    await vite.close();
    throw error;
}
let stopPromise;
const reportStopFailure = (error) => { console.error(error); process.exitCode = 1; };
const onSignal = () => void stop().catch(reportStopFailure);
const stop = () => stopPromise ??= (async () => {
    try {
        // A signal can also be handled by Vite; observing an already closed
        // HTTP listener is successful teardown, not another close request.
        if (server.listening) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
    } finally {
        await vite.close();
        process.removeListener("SIGINT", onSignal);
        process.removeListener("SIGTERM", onSignal);
    }
})();
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
console.log("DMG background preview: http://127.0.0.1:8791/");
