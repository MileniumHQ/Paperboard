// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome, driven over the DevTools protocol. Its calls reach the
// panel service through the test daemon.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { testDaemon } from "./crane";
import { PANEL_ID } from "./service";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.terminal.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());
const CHROMES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const WAIT_MS = 20_000;

function chromeBinary(): string {
    const found = CHROMES.find((file) => fs.existsSync(file));
    if (!found) throw new Error(`These tests drive the panel in headless Chrome, and none is installed (looked for ${CHROMES.join(", ")})`);
    return found;
}

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
                const html = fs.readFileSync(file, "utf8").replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};</script>`);
                return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
            }
            return new Response(Bun.file(file));
        },
    });
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

type CdpEvent = { method: string; params: any };

export interface Page {
    /** evaluates in the page; awaits a returned promise; throws the page's exception */
    evaluate<T = unknown>(expression: string): Promise<T>;
    /** resolves once `predicate` (a page expression) is truthy, checked on every DOM change */
    waitFor(predicate: string, what: string): Promise<void>;
    /** types `text` into whatever has focus, as a keyboard would */
    insertText(text: string): Promise<void>;
    /** clicks the element `selector` finds, at its centre, as a mouse would */
    click(selector: string, button?: "left" | "right"): Promise<void>;
    /** what the page threw, and every message its sockets sent and received */
    exceptions: string[];
    frames: string[];
    close(): Promise<void>;
}

/** opens `url` in a fresh headless Chrome with a throwaway profile */
export async function openPage(url: string): Promise<Page> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-chrome-"));
    const chrome: ChildProcess = spawn(chromeBinary(), [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only", "--window-size=1200,800", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
    let stderr = "";
    const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Chrome did not open its DevTools port:\n${stderr}`)), WAIT_MS);
        chrome.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
            if (match) {
                clearTimeout(timer);
                resolve(Number(match[1]));
            }
        });
        chrome.once("exit", (code) => reject(new Error(`Chrome exited with ${code} before it opened its DevTools port:\n${stderr}`)));
    });
    allowedPorts.add(port);
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new Error("Chrome opened no page");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Could not connect to Chrome's DevTools"));
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const listeners = new Set<(event: CdpEvent) => void>();
    socket.onmessage = (message) => {
        const data = JSON.parse(String(message.data));
        if (data.id && pending.has(data.id)) {
            const call = pending.get(data.id)!;
            pending.delete(data.id);
            if (data.error) call.reject(new Error(`${data.error.message}`));
            else call.resolve(data.result);
        } else if (data.method) for (const listener of listeners) listener(data);
    };
    const send = <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
        new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });

    const exceptions: string[] = [];
    const frames: string[] = [];
    listeners.add(({ method, params }) => {
        if (method === "Runtime.exceptionThrown") exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "exception");
        if (method === "Network.webSocketFrameSent") frames.push(`> ${params.response?.payloadData ?? ""}`);
        if (method === "Network.webSocketFrameReceived") frames.push(`< ${params.response?.payloadData ?? ""}`);
    });
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");

    const evaluate = async <T>(expression: string): Promise<T> => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(`In the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
        return result.result.value as T;
    };
    let closed = false;
    const page: Page = {
        evaluate,
        exceptions,
        frames,
        async insertText(text) {
            await send("Input.insertText", { text });
        },
        async click(selector, button = "left") {
            const box = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            if (!box) throw new Error(`Nothing to click matches ${selector}`);
            await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
            for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button, clickCount: 1 });
        },
        waitFor: (predicate, what) =>
            evaluate(`new Promise((resolve, reject) => {
                // a predicate that throws rejects the wait with its error
                const check = () => Boolean(${predicate});
                if (check()) return resolve(true);
                const observer = new MutationObserver(() => {
                    let ready = false;
                    try { ready = check(); } catch (err) { observer.disconnect(); clearTimeout(timer); reject(err); }
                    if (ready) { observer.disconnect(); clearTimeout(timer); resolve(true); }
                });
                const timer = setTimeout(() => { observer.disconnect(); reject(new Error(${JSON.stringify(`Timed out waiting for ${what}`)} + "; the page shows: " + document.body.innerText.slice(0, 2000))); }, ${WAIT_MS});
                observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
            })`).then(() => undefined),
        async close() {
            if (closed) return;
            closed = true;
            socket.close();
            chrome.kill("SIGKILL");
            await exited;
            allowedPorts.delete(port);
            fs.rmSync(profile, { recursive: true, force: true });
        },
    };
    const loaded = new Promise<void>((resolve) => listeners.add(({ method }) => method === "Page.loadEventFired" && resolve()));
    await send("Page.navigate", { url });
    await loaded;
    return page;
}
