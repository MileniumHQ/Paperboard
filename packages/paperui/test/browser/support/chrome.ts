// A headless Chrome driven over the DevTools protocol, for behaviour jsdom
// cannot show: layout, hit testing, CSS animation, real input. Each test
// file launches its own browser with a throwaway profile; each test opens a
// fresh tab on the fixture page (test/browser/fixture) with one scenario.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, inject } from "vitest";

const CHROME_CANDIDATES = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
];

const STARTUP_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 10_000;

function chromePath(): string {
    const configured = process.env.CHROME_PATH;
    if (configured) {
        if (!existsSync(configured)) throw new Error(`CHROME_PATH is ${configured}, which does not exist`);
        return configured;
    }
    const found = CHROME_CANDIDATES.find((path) => existsSync(path));
    if (!found) {
        throw new Error(
            `PaperUI's browser suite needs Google Chrome: none at ${CHROME_CANDIDATES.join(", ")}. Install it or set CHROME_PATH.`,
        );
    }
    return found;
}

type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };

class Connection {
    private nextId = 1;
    private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
    private readonly listeners = new Set<(msg: Message) => void>();

    private constructor(private readonly ws: WebSocket) {
        ws.addEventListener("message", (event) => {
            const msg = JSON.parse(String(event.data)) as Message;
            if (msg.id !== undefined) {
                const call = this.pending.get(msg.id);
                if (!call) return;
                this.pending.delete(msg.id);
                if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
                else call.resolve(msg.result);
                return;
            }
            for (const listener of this.listeners) listener(msg);
        });
        ws.addEventListener("close", () => {
            for (const call of this.pending.values()) call.reject(new Error(`${call.method}: DevTools connection closed`));
            this.pending.clear();
        });
    }

    static open(url: string): Promise<Connection> {
        const ws = new WebSocket(url);
        return new Promise((resolve, reject) => {
            ws.addEventListener("open", () => resolve(new Connection(ws)), { once: true });
            ws.addEventListener("error", () => reject(new Error(`could not connect to Chrome's DevTools at ${url}`)), { once: true });
        });
    }

    send<T = any>(method: string, params: object = {}, sessionId?: string): Promise<T> {
        const id = this.nextId++;
        this.ws.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
    }

    on(listener: (msg: Message) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    close() {
        this.ws.close();
    }
}

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
    Escape: { code: "Escape", keyCode: 27 },
    Enter: { code: "Enter", keyCode: 13, text: "\r" },
    " ": { code: "Space", keyCode: 32, text: " " },
    Tab: { code: "Tab", keyCode: 9 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
};

export interface Point {
    x: number;
    y: number;
}

export interface PageOptions {
    /** query string after the scenario name, e.g. "theme=dark" */
    query?: string;
    width?: number;
    height?: number;
    /** a phone: touch events enabled */
    touch?: boolean;
    /** runs before any page script, e.g. to set the host's theme attribute */
    beforeLoad?: string;
    /** the system's prefers-color-scheme from the first frame */
    colorScheme?: "light" | "dark";
}

export class Page {
    /** uncaught exceptions and console.error calls in the page */
    readonly errors: string[] = [];
    private readonly off: () => void;

    constructor(
        private readonly conn: Connection,
        private readonly sessionId: string,
        readonly targetId: string,
    ) {
        this.off = conn.on((msg) => {
            if (msg.sessionId !== sessionId) return;
            if (msg.method === "Runtime.exceptionThrown") {
                const details = msg.params.exceptionDetails;
                this.errors.push(details.exception?.description ?? details.text);
            } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
                this.errors.push(msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
            }
        });
    }

    send<T = any>(method: string, params: object = {}): Promise<T> {
        return this.conn.send<T>(method, params, this.sessionId);
    }

    /** Evaluates an expression (awaiting a promise result) and returns its JSON value. */
    async eval<T = unknown>(expression: string): Promise<T> {
        const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (exceptionDetails) {
            throw new Error(`in page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n  evaluating: ${expression}`);
        }
        return result.value as T;
    }

    /** Waits until `condition` (an expression) is truthy in the page, and returns its value. */
    async waitFor<T = unknown>(condition: string, what: string, timeoutMs = WAIT_TIMEOUT_MS): Promise<T> {
        return this.eval<T>(`new Promise((resolve, reject) => {
            const start = performance.now();
            const check = () => {
                let value;
                try { value = (${condition}); } catch (err) { reject(err); return; }
                if (value) { resolve(value); return; }
                if (performance.now() - start > ${timeoutMs}) { reject(new Error(${JSON.stringify(`timed out after ${timeoutMs}ms waiting for ${what}`)})); return; }
                setTimeout(check, 5);
            };
            check();
        })`);
    }

    /**
     * Resolves after the page has rendered two more frames: media query
     * changes, resize observers and the like have been delivered by then.
     */
    async frames() {
        await this.eval("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    }

    /** The center of the first element matching `selector`, failing if it isn't laid out. */
    async center(selector: string): Promise<Point> {
        const point = await this.eval<Point | string>(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return "no element matches";
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return "element has no box";
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        if (typeof point === "string") throw new Error(`${selector}: ${point}`);
        return point;
    }

    async mouse(type: "mouseMoved" | "mousePressed" | "mouseReleased", at: Point, button: "left" | "right" | "none" = "left") {
        await this.send("Input.dispatchMouseEvent", {
            type,
            x: at.x,
            y: at.y,
            button: type === "mouseMoved" ? "none" : button,
            buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0,
            clickCount: type === "mouseMoved" ? 0 : 1,
        });
    }

    /** A real click: the pointer moves there, presses and releases. */
    async clickAt(at: Point, button: "left" | "right" = "left") {
        await this.mouse("mouseMoved", at);
        await this.mouse("mousePressed", at, button);
        await this.mouse("mouseReleased", at, button);
    }

    async click(selector: string, button: "left" | "right" = "left") {
        await this.clickAt(await this.center(selector), button);
    }

    async wheel(at: Point, deltaY: number) {
        await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY });
    }

    async press(key: keyof typeof KEYS, modifiers = 0) {
        const def = KEYS[key];
        const base = { key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
        await this.send("Input.dispatchKeyEvent", { type: def.text ? "keyDown" : "rawKeyDown", ...base, text: def.text });
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    }

    /** A one-finger drag through `points`, lifted at the last one. */
    async touchDrag(points: Point[]) {
        const [first, ...rest] = points;
        await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first.x, y: first.y, id: 1 }] });
        for (const p of rest) {
            await this.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
        }
        await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    async tap(selector: string) {
        await this.touchDrag([await this.center(selector)]);
    }

    /** Fails with what the page reported if it threw or logged an error. */
    expectNoErrors() {
        if (this.errors.length) throw new Error(`the page reported errors:\n${this.errors.join("\n")}`);
    }

    async close() {
        this.off();
        await this.conn.send("Target.closeTarget", { targetId: this.targetId });
    }
}

export class Browser {
    private constructor(
        private readonly proc: ChildProcess,
        private readonly conn: Connection,
        private readonly profile: string,
    ) {}

    static async launch(): Promise<Browser> {
        const executable = chromePath();
        const profile = await mkdtemp(join(tmpdir(), "paperui-chrome-"));
        const proc = spawn(
            executable,
            [
                "--headless=new",
                `--user-data-dir=${profile}`,
                "--remote-debugging-port=0",
                "--no-first-run",
                "--no-default-browser-check",
                // CI containers have no user namespaces for Chrome's sandbox;
                // the page is this suite's own fixture on loopback
                "--no-sandbox",
                "--disable-gpu",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-sync",
                "--mute-audio",
                // play() without a user gesture is refused, as in a panel
                "--autoplay-policy=document-user-activation-required",
                "--force-color-profile=srgb",
                // a wheel scrolls at once, so a test reads where it landed
                "--disable-smooth-scrolling",
                "about:blank",
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        let log = "";
        const wsUrl = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`Chrome (${executable}) printed no DevTools address within ${STARTUP_TIMEOUT_MS}ms:\n${log}`)),
                STARTUP_TIMEOUT_MS,
            );
            proc.stderr!.on("data", (chunk: Buffer) => {
                if (log.length < 64_000) log += chunk.toString();
                const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
                if (match) {
                    clearTimeout(timer);
                    resolve(match[1]);
                }
            });
            proc.once("error", (err) => {
                clearTimeout(timer);
                reject(new Error(`could not start Chrome (${executable}): ${err.message}`));
            });
            proc.once("exit", (code, signal) => {
                clearTimeout(timer);
                reject(new Error(`Chrome (${executable}) exited (${code ?? signal}) before DevTools came up:\n${log}`));
            });
        });
        return new Browser(proc, await Connection.open(wsUrl), profile);
    }

    /** A fresh tab showing one fixture scenario, ready once the scenario has mounted. */
    async open(scenario: string, options: PageOptions = {}): Promise<Page> {
        const { targetId } = await this.conn.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await this.conn.send("Target.attachToTarget", { targetId, flatten: true });
        const page = new Page(this.conn, sessionId, targetId);
        await page.send("Runtime.enable");
        await page.send("Page.enable");
        await page.send("Emulation.setDeviceMetricsOverride", {
            width: options.width ?? 1200,
            height: options.height ?? 800,
            deviceScaleFactor: 1,
            mobile: Boolean(options.touch),
        });
        if (options.touch) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        if (options.colorScheme) {
            await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: options.colorScheme }] });
        }
        if (options.beforeLoad) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: options.beforeLoad });
        const query = `s=${encodeURIComponent(scenario)}${options.query ? `&${options.query}` : ""}`;
        const { errorText } = await page.send("Page.navigate", { url: `${inject("fixtureOrigin")}/?${query}` });
        if (errorText) throw new Error(`fixture page did not load: ${errorText}`);
        await page.waitFor("window.fixtureReady === true || window.fixtureError", `scenario ${scenario} to mount`);
        const failure = await page.eval<string | undefined>("window.fixtureError");
        if (failure) throw new Error(`scenario ${scenario} failed to mount: ${failure}`);
        return page;
    }

    async close() {
        const exited = new Promise<boolean>((resolve) => {
            if (this.proc.exitCode !== null || this.proc.signalCode !== null) return resolve(true);
            const timer = setTimeout(() => resolve(false), STARTUP_TIMEOUT_MS);
            this.proc.once("exit", () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
        // Chrome may exit before it answers, closing the connection: the exit is what counts
        this.conn.send("Browser.close").then(
            () => undefined,
            (err: Error) => console.debug("[chrome] Browser.close:", err.message),
        );
        if (!(await exited)) {
            console.error(`[chrome] still running ${STARTUP_TIMEOUT_MS}ms after Browser.close; killing pid ${this.proc.pid}`);
            this.proc.kill("SIGKILL");
            await new Promise((resolve) => this.proc.once("exit", resolve));
        }
        this.conn.close();
        await rm(this.profile, { recursive: true, force: true });
    }
}

/**
 * The browser for one test file. It launches on the first `open`, so a
 * missing or broken Chrome fails every test with the reason instead of
 * leaving them unrun. Each test's tab is checked for page errors and closed
 * after it; the browser closes after the file.
 */
export function useBrowser() {
    let launching: Promise<Browser> | undefined;
    let current: Page | undefined;
    afterEach(async () => {
        const page = current;
        current = undefined;
        if (!page) return;
        try {
            page.expectNoErrors();
        } finally {
            await page.close();
        }
    });
    afterAll(async () => {
        if (!launching) return;
        const browser = await launching.then(
            (b) => b,
            (err: Error) => {
                // every test that opened a page already failed with this
                console.debug("[chrome] launch had failed:", err.message);
                return undefined;
            },
        );
        await browser?.close();
    });
    return {
        async open(scenario: string, options?: PageOptions): Promise<Page> {
            launching ??= Browser.launch();
            current = await (await launching).open(scenario, options);
            return current;
        },
    };
}
