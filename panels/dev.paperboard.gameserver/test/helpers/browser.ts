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

// Home's side of a widget frame, as the shell does it: widget.html in a frame
// the size of the tile in ?w= and ?h=, asked to show the widget in ?id= for
// the server in ?server=. A wait in this page wakes on this page's changes,
// so each change in the frame is one here too: read the frame with
// WIDGET_TEXT and waitFor() on it.
const WIDGET_HOST = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="widget" src="./widget.html" style="border:0"></iframe>
<script>
const query = new URLSearchParams(location.search);
const size = { w: Number(query.get("w")), h: Number(query.get("h")) };
const frame = document.getElementById("widget");
frame.style.width = size.w * 160 + "px";
frame.style.height = size.h * 150 + "px";
let changes = 0;
const changed = () => (document.body.dataset.changes = String(++changes));
frame.addEventListener("load", () => {
    new MutationObserver(changed).observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, characterData: true });
    frame.contentWindow.postMessage({
        type: "paperboard:initialize",
        generation: "g1",
        widget: { id: query.get("id"), instanceId: "w1", size, visible: true, options: { server: query.get("server") } },
    }, "*");
});
</script></body></html>`;

/** the address of Home's frame showing widget `id` at `w`x`h` for `server`, under a servePanel() url */
export const widgetUrl = (served: string, id: string, server: string, size = { w: 2, h: 2 }) =>
    `${served}/widget-host.html?${new URLSearchParams({ id, server, w: String(size.w), h: String(size.h) })}`;
/** a page expression: the text the widget frame shows */
export const WIDGET_TEXT = `(document.getElementById("widget").contentDocument?.body?.innerText ?? "")`;
/** a page expression: the widget frame's document */
export const WIDGET_DOC = `document.getElementById("widget").contentDocument`;
/** page.waitFor on a widget host page; a timeout names what the widget showed, not the empty host page */
export async function waitForWidget(page: Page, predicate: string, what: string): Promise<void> {
    try {
        await page.waitFor(predicate, what);
    } catch (err) {
        throw new Error(`${err instanceof Error ? err.message : String(err)}\nThe widget shows: ${await page.evaluate<string>(WIDGET_TEXT)}`);
    }
}

/** serves the built UI with a panel credential the test daemon issued; widgetUrl() addresses a Home widget under it */
export async function servePanel(daemon: TestDaemon): Promise<{ url: string; stop: () => void }> {
    const dist = panelUi();
    const granted = await getTransport().call<{ token: string }>("auth:panel-token", { panelId: PANEL_ID });
    const creds = JSON.stringify({ port: daemon.port, token: granted.token, scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            if (pathname === "/widget-host.html") return new Response(WIDGET_HOST, { headers: { "content-type": "text/html; charset=utf-8" } });
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
