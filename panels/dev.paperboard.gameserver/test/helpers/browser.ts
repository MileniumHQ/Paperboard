// The panel's real UI in a real browser: the page is built with the panel's
// own vite config into a temp dir, served on loopback with the crane
// credentials injected the way the shell's panel server does it
// (window.__PAPERBOARD_CRANE, a panel token the daemon issued), and opened in
// headless Chrome, driven over the DevTools protocol. Its calls reach the
// panel service in this test process through the test daemon.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTransport } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../../src/servers";
import { onDaemonStop, type TestDaemon } from "./crane";

const PANEL = path.resolve(import.meta.dir, "../..");
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());
const CHROMES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const WAIT_MS = 20_000;

function chromeBinary(): string {
    const found = CHROMES.find((file) => fs.existsSync(file));
    if (!found) throw new Error(`These tests drive the panel in headless Chrome, and none is installed (looked for ${CHROMES.join(", ")})`);
    return found;
}

let built: string | null = null;
/** the panel's UI as `bun run build` makes it, built once per test file */
export function panelUi(): string {
    if (built) return built;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-ui-"));
    process.once("exit", () => fs.rmSync(out, { recursive: true, force: true }));
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

type CdpEvent = { method: string; params: any };

export interface Page {
    /** evaluates in the page; awaits a returned promise; throws the page's exception */
    evaluate<T = unknown>(expression: string): Promise<T>;
    /** resolves once `predicate` (a page expression) is truthy, checked on every DOM change */
    waitFor(predicate: string, what: string): Promise<void>;
    /** focuses the element `selector` finds and types `text` as a keyboard would; `enter` presses Enter after it */
    type(selector: string, text: string, enter?: boolean): Promise<void>;
    /** clicks the element `selector` finds, at its centre, as a mouse would */
    click(selector: string): Promise<void>;
    /** what the page threw and logged as errors, and every message its sockets sent */
    exceptions: string[];
    consoleErrors: string[];
    sentFrames: string[];
    receivedFrames: string[];
    /** resolves once every call the page has made so far is answered */
    settled(): Promise<void>;
    /** resolves once the page has received a socket message `match` accepts */
    received(match: (frame: string) => boolean, what: string): Promise<void>;
    close(): Promise<void>;
}

/** opens `url` in a fresh headless Chrome with a throwaway profile */
export async function openPage(url: string): Promise<Page> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-chrome-"));
    const chrome: ChildProcess = spawn(chromeBinary(), [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only", "--window-size=1400,900", "about:blank",
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
    const consoleErrors: string[] = [];
    const sentFrames: string[] = [];
    const receivedFrames: string[] = [];
    listeners.add(({ method, params }) => {
        if (method === "Runtime.exceptionThrown") exceptions.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "exception");
        if (method === "Runtime.consoleAPICalled" && params.type === "error") consoleErrors.push(params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
        if (method === "Network.webSocketFrameSent") sentFrames.push(String(params.response?.payloadData ?? ""));
        if (method === "Network.webSocketFrameReceived") receivedFrames.push(String(params.response?.payloadData ?? ""));
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
        consoleErrors,
        sentFrames,
        receivedFrames,
        async settled() {
            // every frame the daemon and page exchange is JSON
            const idOf = (frame: string): unknown => JSON.parse(frame).id;
            const asked = sentFrames.filter((f) => f.includes('"action":"blocks:call"')).map(idOf);
            for (const id of asked) await page.received((f) => idOf(f) === id, `the answer to call ${id}`);
        },
        received: (match, what) =>
            new Promise((resolve, reject) => {
                if (receivedFrames.some(match)) return resolve();
                const timer = setTimeout(() => {
                    listeners.delete(listener);
                    reject(new Error(`Timed out waiting for the page to receive ${what}`));
                }, WAIT_MS);
                const listener = ({ method, params }: CdpEvent) => {
                    if (method !== "Network.webSocketFrameReceived" || !match(String(params.response?.payloadData ?? ""))) return;
                    clearTimeout(timer);
                    listeners.delete(listener);
                    resolve();
                };
                listeners.add(listener);
            }),
        async type(selector, text, enter) {
            await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Nothing matches ${selector.replace(/"/g, "'")}"); el.focus(); })()`);
            await send("Input.insertText", { text });
            if (enter) {
                await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
                await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
            }
        },
        async click(selector) {
            const box = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            if (!box) throw new Error(`Nothing to click matches ${selector}`);
            for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
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
            // every call the page made is answered first: a service still
            // working on one when the daemon goes would answer into nothing
            await page.settled();
            socket.close();
            chrome.kill("SIGKILL");
            await exited;
            fs.rmSync(profile, { recursive: true, force: true });
        },
    };
    onDaemonStop(() => page.close());
    const loaded = new Promise<void>((resolve) => listeners.add(({ method }) => method === "Page.loadEventFired" && resolve()));
    await send("Page.navigate", { url });
    await loaded;
    return page;
}
