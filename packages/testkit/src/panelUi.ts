// A panel's real UI for the browser tests of any panel: built with the
// panel's own vite config into a temp dir once per suite (withPanelUi.ts) or
// once per test process, served on
// loopback with the crane credentials injected the way the shell's panel
// server does it (window.__PAPERBOARD_CRANE, a panel token the daemon
// issued), and framed the way the shell frames it: as a Home widget
// (/widget-host.html) or as a panel page (/panel-host.html). Open the
// addresses in headless Chrome (packages/testkit/src/chrome.ts).
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Page } from "./chrome";

const built = new Map<string, string>();

/** the variable withPanelUi.ts tells a suite's test files its panel's built UI in: {"panelDir", "dir"} */
export const SUITE_PANEL_UI = "TESTKIT_PANEL_UI";

/** the command that builds the panel's UI with its own vite config, as `bun run build` makes it, into `out`; run it in the panel's folder */
export const panelUiBuild = (out: string): string[] => [process.execPath, "x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"];

/** throws why, when the build into `out` that ended with `code` made no UI */
export function checkPanelUiBuilt(out: string, code: number | null, output: string): void {
    if (code !== 0 || !fs.existsSync(path.join(out, "index.html"))) throw new Error(`Building the panel UI failed (exit ${code}):\n${output}`);
}

/**
 * The panel's UI as `bun run build` makes it: the suite's, built once before
 * any test started, when the suite runs under withPanelUi.ts in this panel's
 * folder. A file run by itself builds it once per test process instead, into
 * the suite's throwaway PAPERBOARD_DIR, which its hermetic preload removes
 * once every file has run (bun test fires no exit handlers).
 */
export function panelUi(panelDir: string): string {
    const told = process.env[SUITE_PANEL_UI];
    if (told) {
        const suite = JSON.parse(told) as { panelDir: string; dir: string };
        if (path.resolve(suite.panelDir) === path.resolve(panelDir)) return suite.dir;
    }
    const known = built.get(panelDir);
    if (known) return known;
    const home = process.env.PAPERBOARD_DIR;
    if (!home || !home.startsWith(os.tmpdir())) throw new Error(`The panel UI is built into the suite's throwaway PAPERBOARD_DIR, not ${home}`);
    const out = fs.mkdtempSync(path.join(home, `${path.basename(panelDir)}-ui-`));
    const [command, ...args] = panelUiBuild(out);
    const build = spawnSync(command!, args, { cwd: panelDir, encoding: "utf8" });
    checkPanelUiBuilt(out, build.status, `${build.stdout}\n${build.stderr}`);
    built.set(panelDir, out);
    return out;
}

// Home's side of a widget frame, as the shell does it: the widget page in a
// frame the size of the tile in ?w= and ?h=, asked to show the widget in
// ?id=, every other query parameter being one of its options. A wait in this
// page wakes on this page's changes, so each change in the frame is one here
// too: read the frame with WIDGET_TEXT and wait on it. window.showWidget(visible)
// is the shell scrolling the widget away and back; window.widgetSaid lists
// what the widget said back to the shell.
const WIDGET_HOST = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="widget" src="./widget.html" style="border:0"></iframe>
<script>
const query = new URLSearchParams(location.search);
const size = { w: Number(query.get("w")), h: Number(query.get("h")) };
const options = {};
for (const [key, value] of query) if (!["id", "w", "h"].includes(key)) options[key] = value;
const frame = document.getElementById("widget");
frame.style.width = size.w * 160 + "px";
frame.style.height = size.h * 150 + "px";
window.widgetSaid = [];
let changes = 0;
const changed = () => (document.body.dataset.changes = String(++changes));
window.showWidget = (visible) => frame.contentWindow.postMessage({ type: "paperboard:widget-update", generation: "g1", visible }, "*");
addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    window.widgetSaid.push(event.data?.type);
    changed();
});
frame.addEventListener("load", () => {
    new MutationObserver(changed).observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, characterData: true });
    frame.contentWindow.postMessage({
        type: "paperboard:initialize",
        generation: "g1",
        widget: { id: query.get("id"), instanceId: "w1", size, visible: true, options },
    }, "*");
});
</script></body></html>`;

// The shell's side of a panel frame: the panel's page, with ?… of this page's
// query passed on to it, in a frame, challenged as the shell does it, so it
// can ask the shell for what only the shell shows (the backup location
// chooser). Each request it sends is kept in window.shellRequests and left
// unanswered, as a chooser still open would be. Read the frame with PANEL_DOC.
// It names the computer as the shell names this one. With ?initialize=later
// the challenge waits for window.initialize(), as a frame's own first reads
// can run before the shell's message lands.
const PANEL_HOST = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="panel" style="border:0;width:100vw;height:100vh"></iframe>
<script>
const frame = document.getElementById("panel");
window.shellRequests = [];
let changes = 0;
const changed = () => (document.body.dataset.changes = String(++changes));
window.addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && typeof event.data?.requestId === "string") { window.shellRequests.push(event.data.type); changed(); }
});
window.initialize = () => frame.contentWindow.postMessage({ type: "paperboard:initialize", generation: "g1", computerName: "This Computer" }, "*");
frame.addEventListener("load", () => {
    new MutationObserver(changed).observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, characterData: true });
    if (new URLSearchParams(location.search).get("initialize") !== "later") window.initialize();
});
frame.src = "./" + location.search;
</script></body></html>`;

export interface ServePanelUi {
    /** the panel's folder, the one its vite config is in */
    panelDir: string;
    panelId: string;
    /** the port of the daemon the panel's calls reach */
    port: number;
    /** a panel token that daemon issued for `panelId` */
    token: string;
    /** the value of data-paper-mobile on the page, when the panel is shown in one mode */
    mobile?: boolean;
}

/** serves the built UI with the panel credential; widgetUrl() addresses a Home widget under it, panelHostUrl() a framed page */
export function servePanelUi(options: ServePanelUi): { url: string; stop: () => void } {
    const dist = panelUi(options.panelDir);
    const creds = JSON.stringify({ port: options.port, token: options.token, scoped: true, computerId: "local", panelId: options.panelId }).replace(/</g, "\\u003c");
    const mobile = options.mobile === undefined ? "" : `document.documentElement.setAttribute("data-paper-mobile",${JSON.stringify(String(options.mobile))});`;
    const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            if (pathname === "/widget-host.html") return html(WIDGET_HOST);
            if (pathname === "/panel-host.html") return html(PANEL_HOST);
            const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
            if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
            if (file.endsWith(".html")) {
                return html(fs.readFileSync(file, "utf8").replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};${mobile}</script>`));
            }
            return new Response(Bun.file(file));
        },
    });
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/**
 * the address of Home's frame showing widget `id` at `size` tiles, under a
 * servePanelUi() url; each of `options` is one of the widget's options
 */
export const widgetUrl = (served: string, id: string, options: Record<string, string> = {}, size = { w: 2, h: 2 }) =>
    `${served}/widget-host.html?${new URLSearchParams({ id, w: String(size.w), h: String(size.h), ...options })}`;

/** the address of the shell's frame showing the panel's page, with `query` passed on to it, under a servePanelUi() url */
export const panelHostUrl = (served: string, query: Record<string, string> = {}) => `${served}/panel-host.html?${new URLSearchParams(query)}`;

/** a page expression: the panel frame's document */
export const PANEL_DOC = `document.getElementById("panel").contentDocument`;
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
