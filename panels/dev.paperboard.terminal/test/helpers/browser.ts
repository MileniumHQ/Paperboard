// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued) and mobile mode
// (data-paper-mobile, off), and opened in headless Chrome
// (scripts/testing/chrome.ts). Its calls reach the panel service through the
// test daemon.
import { afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { launchChrome, type Chrome, type Page as ChromePage } from "../../../../scripts/testing/chrome";
import { testDaemon } from "./crane";
import { PANEL_ID } from "./service";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.terminal.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());
let built: string | null = null;
/** the panel's UI as `bun run build` makes it, built once per test process */
function panelUi(): string {
    if (built) return built;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-ui-"));
    (globalThis as any)[Symbol.for("paperboard.terminal.test.teardown")].push(() => fs.rmSync(out, { recursive: true, force: true }));
    const build = spawnSync(process.execPath, ["x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(path.join(out, "index.html"))) {
        throw new Error(`Building the panel UI failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    built = out;
    return out;
}

/** serves the built UI with a panel credential the test daemon issued */
export async function servePanel(): Promise<{ url: string; stop: () => void }> {
    const daemon = await testDaemon();
    const dist = panelUi();
    const granted = (await getTransport().call("auth:panel-token", { panelId: PANEL_ID })) as { token: string };
    const creds = JSON.stringify({ port: daemon.port, token: granted.token, scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
            if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
            if (file.endsWith(".html")) {
                const html = fs.readFileSync(file, "utf8").replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};document.documentElement.setAttribute("data-paper-mobile","false");</script>`);
                return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
            }
            return new Response(Bun.file(file));
        },
    });
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

export interface Page extends ChromePage {
    /** types `text` into whatever has focus, as a keyboard would */
    insertText(text: string): Promise<void>;
    /** clicks, as a mouse would, the innermost shown `selector` element whose text includes `text` */
    clickText(selector: string, text: string): Promise<void>;
    /** presses and lets go of one key (Enter, Tab, Escape…) in whatever has focus, as a keyboard would */
    press(key: "Enter" | "Escape" | "Tab"): Promise<void>;
}

const KEYS = { Enter: [13, "\r"], Escape: [27, ""], Tab: [9, "\t"] } as const;

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
            page.insertText = async (text) => {
                await page.send("Input.insertText", { text });
            };
            page.press = async (key) => {
                const [keyCode, text] = KEYS[key];
                await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
                await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode });
            };
            page.clickText = async (selector, text) => {
                const tag = `t${Math.random().toString(36).slice(2)}`;
                const shown = `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getClientRects().length > 0 && el.innerText?.includes(${JSON.stringify(text)}))`;
                await page.waitFor(`${shown}.length > 0`, `a ${selector} showing "${text}"`);
                // a menu that just opened places itself on the next frame: it is clicked where it settles
                await page.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
                await page.evaluate(`(() => {
                    const all = ${shown};
                    const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
                    inner[0].dataset.test = ${JSON.stringify(tag)};
                })()`);
                await page.click(`[data-test="${tag}"]`);
            };
            return page;
        },
    };
}
