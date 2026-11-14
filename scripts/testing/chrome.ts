// A real page in headless Chrome, driven over the DevTools protocol, for the
// suites that test Paperboard's UI as a person uses it: the Game Server
// panel's (panels/dev.paperboard.gameserver/test/helpers/browser.ts) and the
// shell's (apps/paperboard/tests/shell). Every wait is on something the page
// does (a DOM change, a socket message), never on a fixed delay.
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CHROMES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const WAIT_MS = 20_000;

function chromeBinary(): string {
    const found = CHROMES.find((file) => fs.existsSync(file));
    if (!found) throw new Error(`These tests drive the UI in headless Chrome, and none is installed (looked for ${CHROMES.join(", ")})`);
    return found;
}

type CdpEvent = { method: string; params: any };

export interface Page {
    /** evaluates in the page; awaits a returned promise; throws the page's exception */
    evaluate<T = unknown>(expression: string): Promise<T>;
    /** resolves once `predicate` (a page expression) is truthy, checked on every DOM change */
    waitFor(predicate: string, what: string): Promise<void>;
    /** focuses the element `selector` finds and types `text` as a keyboard would; `enter` presses Enter after it */
    type(selector: string, text: string, enter?: boolean): Promise<void>;
    /** clicks the element `selector` finds, at its centre, as a mouse would; "right" opens its context menu */
    click(selector: string, button?: "left" | "right"): Promise<void>;
    /** what the page threw and logged as errors, and every message its sockets sent */
    exceptions: string[];
    consoleErrors: string[];
    sentFrames: string[];
    receivedFrames: string[];
    /** resolves once every call the page has made so far is answered */
    settled(): Promise<void>;
    /** resolves once the page has received a socket message `match` accepts */
    received(match: (frame: string) => boolean, what: string): Promise<void>;
    /** what the page shows, as a PNG, for a person to look at */
    screenshot(): Promise<Buffer>;
    /** lays the page out at `width` by `height` CSS pixels, as a window resized to that would */
    resize(width: number, height: number): Promise<void>;
    /** loads `url` in this page; resolves once it has loaded */
    navigate(url: string): Promise<void>;
    close(): Promise<void>;
}

export interface ChromeOptions {
    /** "width,height" */
    windowSize?: string;
    /** told Chrome's DevTools port, for a suite that only lets known ports through */
    onPort?: (port: number) => void;
    /** which socket messages the page sent are calls that get an answer (settled() waits for those) */
    isCall?: (frame: string) => boolean;
    /** a script run in every document before its own, to watch or hold what the page does */
    init?: string;
}

/** opens `url` in a fresh headless Chrome with a throwaway profile */
export async function openChrome(url: string, options: ChromeOptions = {}): Promise<Page> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "paperboard-chrome-"));
    const chrome: ChildProcess = spawn(chromeBinary(), [
        "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
        "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only",
        `--window-size=${options.windowSize ?? "1400,900"}`, "about:blank",
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
    options.onPort?.(port);
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
    if (options.init) await send("Page.addScriptToEvaluateOnNewDocument", { source: options.init });

    const evaluate = async <T>(expression: string): Promise<T> => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(`In the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
        return result.result.value as T;
    };
    const navigate = async (to: string) => {
        const loaded = new Promise<void>((resolve) => {
            const listener = ({ method }: CdpEvent) => {
                if (method !== "Page.loadEventFired") return;
                listeners.delete(listener);
                resolve();
            };
            listeners.add(listener);
        });
        await send("Page.navigate", { url: to });
        await loaded;
    };
    let closed = false;
    const page: Page = {
        evaluate,
        exceptions,
        consoleErrors,
        sentFrames,
        receivedFrames,
        navigate,
        async settled() {
            if (!options.isCall) return;
            // every frame the daemon and page exchange is JSON
            const idOf = (frame: string): unknown => JSON.parse(frame).id;
            const asked = sentFrames.filter(options.isCall).map(idOf);
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
        async click(selector, button = "left") {
            const box = await evaluate<{ x: number; y: number } | null>(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            if (!box) throw new Error(`Nothing to click matches ${selector}`);
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
        async screenshot() {
            const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png" });
            return Buffer.from(shot.data, "base64");
        },
        async resize(width, height) {
            await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
            // the page has laid itself out again once a frame is drawn at the new size
            await evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        },
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
    await navigate(url);
    return page;
}
