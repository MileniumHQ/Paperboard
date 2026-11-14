// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome (scripts/testing/chrome.ts). Its calls reach the panel
// service in this test process through the test daemon.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { openChrome, type Page } from "../../../../scripts/testing/chrome";
import { PANEL_ID } from "../../src/servers";
import { onDaemonStop, type TestDaemon } from "./crane";

export type { Page } from "../../../../scripts/testing/chrome";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

let built: string | null = null;
/** the panel's UI as `bun run build` makes it, built once per test file */
export function panelUi(): string {
    if (built) return built;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-ui-"));
    const build = spawnSync(process.execPath, ["x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(path.join(out, "index.html"))) {
        throw new Error(`Building the panel UI failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    built = out;
    return out;
}

/** serves the built UI with a panel credential the test daemon issued */
export async function servePanel(daemon: TestDaemon): Promise<{ url: string; stop: () => void }> {
    const dist = panelUi();
    const granted = await getTransport().call<{ token: string }>("auth:panel-token", { panelId: PANEL_ID });
    const creds = JSON.stringify({ port: daemon.port, token: granted.token, scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
            if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
            if (file.endsWith(".html")) {
                const html = fs.readFileSync(file, "utf8").replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};</script>`);
                return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
            }
            return new Response(Bun.file(file));
        },
    });
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/** opens `url` in a fresh headless Chrome with a throwaway profile; `windowSize` is "width,height" */
export async function openPage(url: string, windowSize = "1400,900"): Promise<Page> {
    const page = await openChrome(url, {
        windowSize,
        // the hermetic guard lets the test reach this Chrome's DevTools
        onPort: (port) => allowedPorts.add(port),
        isCall: (frame) => frame.includes('"action":"blocks:call"'),
    });
    onDaemonStop(() => page.close());
    return page;
}
