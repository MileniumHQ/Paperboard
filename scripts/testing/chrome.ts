// A real page in headless Chrome, driven over the DevTools protocol, for the
// suites that test Paperboard's UI as a person uses it: the Game Server
// panel's (panels/dev.paperboard.gameserver/test/helpers/browser.ts), the
// Agents panel's (panels/dev.paperboard.agents/test/support/panel.ts), the
// shell's (apps/paperboard/tests/shell) and PaperUI's
// (packages/paperui/test/browser/support/browser.ts). It runs under Bun and
// under Node (vitest). Every wait is on something the page
// does (a DOM change, a socket message), never on a fixed delay.
//
// openChrome() starts a Chrome for one page. A suite that opens many pages
// starts one Chrome with launchChrome() and opens each page in a browser
// context of its own, so pages share no cookies, storage or cache, and
// Chrome starts once instead of once per page.
//
// Chrome leaves nothing behind: its profile is its temp dir too (Chrome
// puts its singleton socket under TMPDIR), and the profile is removed and
// Chrome killed on every way out: close(), a failed start, and the test
// process ending without closing it (a failure, a timeout, Ctrl-C, a kill).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CHROMES = ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const WAIT_MS = 20_000;

function chromeBinary(): string {
    const configured = process.env.CHROME_PATH;
    if (configured) {
        if (!fs.existsSync(configured)) throw new Error(`CHROME_PATH is ${configured}, which does not exist`);
        return configured;
    }
    const found = CHROMES.find((file) => fs.existsSync(file));
    if (!found) throw new Error(`These tests drive the UI in headless Chrome, and none is installed (looked for ${CHROMES.join(", ")}). Install it or set CHROME_PATH.`);
    return found;
}

export type CdpEvent = { method: string; params: any };

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
    /**
     * resolves once what moves on the page has come to rest, so a click lands
     * where it aims: every finite animation has finished or was cancelled (a
     * menu rebuilt mid-open cancels its own). A PaperUI toast's time line runs
     * on and isn't waited for.
     */
    motionSettled(): Promise<void>;
    /** resolves once the page has received a socket message `match` accepts */
    received(match: (frame: string) => boolean, what: string): Promise<void>;
    /** what the page shows, as a PNG, for a person to look at */
    screenshot(): Promise<Buffer>;
    /** lays the page out at `width` by `height` CSS pixels, as a window resized to that would */
    resize(width: number, height: number): Promise<void>;
    /** loads `url` in this page; resolves once it has loaded, throws when Chrome could not load it */
    navigate(url: string): Promise<void>;
    /** a raw DevTools call to this page, for input and emulation the helpers above don't cover */
    send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
    /** calls `listener` with every DevTools event from this page; returns what stops it */
    on(listener: (event: CdpEvent) => void): () => void;
    close(): Promise<void>;
}

export interface LaunchOptions {
    /** "width,height" */
    windowSize?: string;
    /** told Chrome's DevTools port, for a suite that only lets known ports through */
    onPort?: (port: number) => void;
    /** more Chrome switches, after the ones every suite gets */
    args?: string[];
}

export type ChromeOptions = LaunchOptions & PageOptions;

// Stops Chrome's process group and removes its profile once this test
// process ends without having done so. The reaper waits on a FIFO that only
// this process holds open for writing, which closes however it ends, even
// killed outright (bun test runs no exit hooks, and kills the processes it
// started as it exits, so the reaper runs detached from it, in the
// background of a shell that has already exited). A line on the FIFO
// instead says all is done already. Chrome's helpers can still be writing
// as they die, so the removal is tried again until the profile is gone.
interface Reaper {
    /** Chrome is stopped: the reaper has nothing to do */
    dismiss(): void;
}

async function reaper(group: number, profile: string): Promise<Reaper> {
    const fifo = path.join(profile, "reaper");
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    if (made.status !== 0) throw new Error(`Could not make the Chrome reaper's FIFO (exit ${made.status}): ${made.stderr}`);
    // `kill -s KILL -- -PGID` is the POSIX form every /bin/sh takes; dash
    // (Ubuntu's /bin/sh) refuses `kill -9 -- -PGID` and kills nothing
    const reap = 'exec < "$3"; if read -r _; then exit 0; fi; kill -s KILL -- "-$1"; for _ in 1 2 3 4 5 6 7 8 9 10; do rm -rf -- "$2"; [ -e "$2" ] || exit 0; sleep 0.2; done; exit 1';
    // in a session of its own, so no signal to this process's group reaches it
    const shell = spawn("/bin/sh", ["-c", `(${reap}) > /dev/null 2>&1 &`, "chrome-reaper", String(group), profile, fifo], {
        stdio: "ignore",
        detached: true,
    });
    const status = await new Promise<number | null>((resolve, reject) => {
        shell.once("exit", (code) => resolve(code));
        shell.once("error", reject);
    });
    if (status !== 0) throw new Error(`Could not start the Chrome reaper (exit ${status})`);
    // opened once the reaper reads it, so a dismissal can't land before it
    // listens and be lost; this process is its only writer
    let fd: number | null = null;
    const deadline = Date.now() + WAIT_MS;
    while (fd === null) {
        try {
            fd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        } catch (err) {
            // ENXIO: nothing reads it yet
            if ((err as NodeJS.ErrnoException).code !== "ENXIO" || Date.now() > deadline) throw err;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }
    return {
        dismiss() {
            fs.writeSync(fd!, "done\n");
            fs.closeSync(fd!);
        },
    };
}

/** a headless Chrome of its own, with a throwaway profile, that pages open in */
export interface Chrome {
    /** loads `url` in a new page of its own browser context: no cookies, storage or cache shared with the browser's other pages */
    open(url: string, options?: PageOptions): Promise<Page>;
    /** stops Chrome and removes its profile; pages still open fail with why */
    close(): Promise<void>;
}

export interface PageOptions {
    /** which socket messages the page sent are calls that get an answer (settled() waits for those) */
    isCall?: (frame: string) => boolean;
    /** a script run in every document before its own, to watch or hold what the page does */
    init?: string;
}

/** opens `url` in a fresh headless Chrome with a throwaway profile; closing the page stops that Chrome */
export async function openChrome(url: string, options: ChromeOptions = {}): Promise<Page> {
    const chrome = await launchChrome(options);
    let page: Page;
    try {
        page = await chrome.open(url, options);
    } catch (err) {
        await chrome.close();
        throw err;
    }
    const closePage = page.close;
    let closing: Promise<void> | null = null;
    page.close = () => {
        closing ??= closePage().finally(() => chrome.close());
        return closing;
    };
    return page;
}

/** starts a headless Chrome with a throwaway profile, for a suite to open many pages in */
export async function launchChrome(options: LaunchOptions = {}): Promise<Chrome> {
    // short: the singleton socket's path (<profile>/com.google.Chrome.XXXXXX/
    // SingletonSocket) must fit in 108 bytes, under a suite's own TMPDIR too
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pb-chrome-"));
    let chrome: ChildProcess | null = null;
    let reap: Reaper | null = null;
    // Chrome runs in a process group of its own, and the whole group goes:
    // its helpers would otherwise outlive it and write into the profile
    // after it is removed. Only while Chrome itself is unreaped, so the
    // group id can't belong to anything else yet.
    const kill = () => {
        if (!chrome?.pid || chrome.exitCode !== null || chrome.signalCode !== null) return;
        process.kill(-chrome.pid, "SIGKILL");
    };
    let exited: Promise<void> = Promise.resolve();
    let stopping: Promise<void> | null = null;
    const shutdown = () => {
        stopping ??= (async () => {
            kill();
            await exited;
            reap?.dismiss();
            fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10 });
        })();
        return stopping;
    };
    try {
        chrome = spawn(chromeBinary(), [
            "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only",
            `--window-size=${options.windowSize ?? "1400,900"}`, ...(options.args ?? []), "about:blank",
        ], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TMPDIR: profile }, detached: true });
        const started = chrome;
        exited = new Promise<void>((resolve) => {
            started.once("exit", () => resolve());
            started.once("error", () => resolve());
        });
        const start = watchStart(started);
        if (started.pid) reap = await reaper(started.pid, profile);
        const port = await start.port;
        if (port instanceof Error) throw port;
        options.onPort?.(port);
        const stderr = () => start.stderr().trim();
        const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
        const browser = await connect(version.webSocketDebuggerUrl, started, stderr);
        return {
            async open(url, pageOptions = {}) {
                const { browserContextId } = await browser.send<{ browserContextId: string }>("Target.createBrowserContext");
                // its pages go with it
                const dispose = async () => {
                    if (!browser.gone()) await browser.send("Target.disposeBrowserContext", { browserContextId });
                };
                try {
                    const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
                    const connection = await connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`, started, stderr);
                    return await drive(connection, url, pageOptions, dispose);
                } catch (err) {
                    await dispose();
                    throw err;
                }
            },
            async close() {
                browser.close();
                await shutdown();
            },
        };
    } catch (err) {
        await shutdown();
        throw err;
    }
}

interface Start {
    /** the DevTools port Chrome opened, or why it opened none */
    port: Promise<number | Error>;
    /** everything Chrome printed so far, for failure messages */
    stderr(): string;
}

// Watched from the moment Chrome is spawned, so an exit before anyone waits
// on the port is still seen. Never rejects: a start nobody waits on (the
// reaper failed first) leaves no unhandled rejection behind.
function watchStart(chrome: ChildProcess): Start {
    let stderr = "";
    const port = new Promise<number | Error>((resolve) => {
        const timer = setTimeout(() => resolve(new Error(`Chrome did not open its DevTools port:\n${stderr}`)), WAIT_MS);
        chrome.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr);
            if (match) {
                clearTimeout(timer);
                resolve(Number(match[1]));
            }
        });
        chrome.once("error", (err) => {
            clearTimeout(timer);
            resolve(new Error(`Chrome could not start: ${err.message}`));
        });
        chrome.once("exit", (code, signal) => {
            clearTimeout(timer);
            resolve(new Error(`Chrome exited (${code ?? signal}) before it opened its DevTools port:\n${stderr}`));
        });
    });
    return { port, stderr: () => stderr };
}

interface Connection {
    send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
    /** every DevTools event on this connection */
    listeners: Set<(event: CdpEvent) => void>;
    /** told why, once, when the connection is lost */
    onGone: Set<(why: Error) => void>;
    /** why the connection is lost, or null while it is up */
    gone(): Error | null;
    close(): void;
}

// once the connection to Chrome is gone, every call and wait still pending
// fails with why, instead of hanging until a timeout
async function connect(url: string, chrome: ChildProcess, stderr: () => string): Promise<Connection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Could not connect to Chrome's DevTools"));
    });
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const listeners = new Set<(event: CdpEvent) => void>();
    let gone: Error | null = null;
    const onGone = new Set<(why: Error) => void>();
    const lose = (why: Error) => {
        if (gone) return;
        gone = why;
        for (const call of pending.values()) call.reject(why);
        pending.clear();
        for (const fail of onGone) fail(why);
        onGone.clear();
    };
    const exit = (code: number | null, signal: NodeJS.Signals | null) => lose(new Error(`Chrome exited (${code ?? signal})${stderr() ? `:\n${stderr()}` : ""}`));
    socket.onclose = () => {
        chrome.off("exit", exit);
        lose(new Error(`Chrome's DevTools connection closed${stderr() ? `:\n${stderr()}` : ""}`));
    };
    chrome.once("exit", exit);
    socket.onmessage = (message) => {
        const data = JSON.parse(String(message.data));
        if (data.id && pending.has(data.id)) {
            const call = pending.get(data.id)!;
            pending.delete(data.id);
            if (data.error) call.reject(new Error(`${data.error.message}`));
            else call.resolve(data.result);
        } else if (data.method) for (const listener of listeners) listener(data);
    };
    return {
        send: (method, params = {}) =>
            new Promise((resolve, reject) => {
                if (gone) return reject(gone);
                const id = nextId++;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            }),
        listeners,
        onGone,
        gone: () => gone,
        close: () => socket.close(),
    };
}

async function drive(connection: Connection, url: string, options: PageOptions, dispose: () => Promise<void>): Promise<Page> {
    const { send, listeners, onGone } = connection;
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
        let listener: (event: CdpEvent) => void = () => {};
        let fail: (why: Error) => void = () => {};
        const loaded = new Promise<void>((resolve, reject) => {
            listener = ({ method }: CdpEvent) => {
                if (method !== "Page.loadEventFired") return;
                listeners.delete(listener);
                onGone.delete(fail);
                resolve();
            };
            fail = reject;
            listeners.add(listener);
            onGone.add(fail);
        });
        try {
            const result = await send<{ errorText?: string }>("Page.navigate", { url: to });
            if (result.errorText) throw new Error(`Chrome could not load ${to}: ${result.errorText}`);
        } catch (err) {
            // the load that will never come is not waited on
            listeners.delete(listener);
            onGone.delete(fail);
            throw err;
        }
        await loaded;
    };
    let closing: Promise<void> | null = null;
    const page: Page = {
        evaluate,
        exceptions,
        consoleErrors,
        sentFrames,
        receivedFrames,
        navigate,
        send,
        on(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        motionSettled: () =>
            evaluate<void>(
                `Promise.allSettled(document.getAnimations().filter((a) => !a.effect?.target?.matches?.("[data-paper-toast-time]") && a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished)).then(() => undefined)`,
            ),
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
                if (connection.gone()) return reject(connection.gone());
                const stop = () => {
                    clearTimeout(timer);
                    listeners.delete(listener);
                    onGone.delete(fail);
                };
                const fail = (why: Error) => {
                    stop();
                    reject(why);
                };
                const timer = setTimeout(() => fail(new Error(`Timed out waiting for the page to receive ${what}`)), WAIT_MS);
                const listener = ({ method, params }: CdpEvent) => {
                    if (method !== "Network.webSocketFrameReceived" || !match(String(params.response?.payloadData ?? ""))) return;
                    stop();
                    resolve();
                };
                listeners.add(listener);
                onGone.add(fail);
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
        close() {
            // a second close() waits for (and fails with) the first
            closing ??= (async () => {
                try {
                    // every call the page made is answered first: a service still
                    // working on one when the daemon goes would answer into nothing
                    await page.settled();
                } finally {
                    connection.close();
                    await dispose();
                }
            })();
            return closing;
        },
    };
    try {
        await navigate(url);
    } catch (err) {
        connection.close();
        throw err;
    }
    return page;
}
