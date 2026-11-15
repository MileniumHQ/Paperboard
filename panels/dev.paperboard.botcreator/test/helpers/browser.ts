// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome (scripts/testing/chrome.ts). Its calls reach the panel
// service through the test daemon.
import { afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { launchChrome, type Chrome, type Page as ChromePage } from "../../../../scripts/testing/chrome";
import { PANEL_ID } from "../../src/bots";
import { testDaemon } from "./daemon";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.botcreator.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());
let built: string | null = null;
/** the panel's UI as `bun run build` makes it, built once per test process */
function panelUi(): string {
    if (built) return built;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "botcreator-ui-"));
    (globalThis as any)[Symbol.for("paperboard.botcreator.test.teardown")].push(() => fs.rmSync(out, { recursive: true, force: true }));
    const build = spawnSync(process.execPath, ["x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(path.join(out, "index.html"))) {
        throw new Error(`Building the panel UI failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    built = out;
    return out;
}

// Home's side of a widget frame, as the shell does it: the widget page in a
// frame the size of the tile in ?w= and ?h=, asked to show the widget in
// ?id= for the bot in ?bot=. window.showWidget(visible) is the shell
// scrolling it away and back, which reads the service again.
const WIDGET_HOST = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="widget" src="/widget.html" style="border:0"></iframe>
<script>
const query = new URLSearchParams(location.search);
const size = { w: Number(query.get("w")), h: Number(query.get("h")) };
const frame = document.getElementById("widget");
frame.style.width = size.w * 160 + "px";
frame.style.height = size.h * 150 + "px";
// a wait in this page wakes on this page's changes: each change in the frame is one here too
let changes = 0;
const changed = () => (document.body.dataset.changes = String(++changes));
window.showWidget = (visible) => frame.contentWindow.postMessage({ type: "paperboard:widget-update", generation: "g1", visible }, "*");
frame.addEventListener("load", () => {
    new MutationObserver(changed).observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, characterData: true });
    frame.contentWindow.postMessage({
        type: "paperboard:initialize",
        generation: "g1",
        widget: { id: query.get("id"), instanceId: "w1", size, visible: true, options: { bot: query.get("bot") } },
    }, "*");
});
</script></body></html>`;

/** serves the built UI with a panel credential the test daemon issued; /widget-host.html?id=…&w=…&h=…&bot=… shows a Home widget */
export async function servePanel(): Promise<{ url: string; stop: () => void }> {
    const daemon = await testDaemon();
    const dist = panelUi();
    const creds = JSON.stringify({ port: daemon.port, token: await daemon.panelToken(PANEL_ID), scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
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

export interface Page extends ChromePage {
    /** drags the element `selector` finds `dx` px to the right with the mouse, in steps, and lets go */
    drag(selector: string, dx: number): Promise<void>;
}

/**
 * One headless Chrome for the test file that calls this (at its top level),
 * started with its first page and stopped once the file is done; each page
 * opens in a browser context of its own.
 */
export function panelBrowser(): { open(url: string): Promise<Page> } {
    let chrome: Promise<Chrome> | null = null;
    afterAll(async () => {
        if (chrome) await (await chrome).close();
    });
    return {
        async open(url) {
            chrome ??= launchChrome({
                windowSize: "1200,800",
                // the hermetic guard lets the test reach this Chrome's DevTools
                onPort: (port) => allowedPorts.add(port),
            });
            const page = (await (await chrome).open(url)) as Page;
            page.drag = async (selector, dx) => {
                const box = await page.evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
                if (!box) throw new Error(`Nothing to drag matches ${selector}`);
                const mouse = (type: string, x: number, buttons: number, extra: Record<string, unknown> = {}) =>
                    page.send("Input.dispatchMouseEvent", { type, x, y: box.y, button: "left", buttons, ...extra });
                await mouse("mouseMoved", box.x, 0);
                await mouse("mousePressed", box.x, 1, { clickCount: 1 });
                const steps = 10;
                for (let step = 1; step <= steps; step++) await mouse("mouseMoved", box.x + (dx * step) / steps, 1);
                await mouse("mouseReleased", box.x + dx, 0, { clickCount: 1 });
            };
            return page;
        },
    };
}
