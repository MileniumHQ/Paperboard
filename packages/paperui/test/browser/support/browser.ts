// PaperUI's view of a page in headless Chrome, for behaviour jsdom cannot
// show: layout, hit testing, CSS animation, real input. Chrome itself (its
// launch, its DevTools connection, and removing it and its profile on every
// way out) is packages/testkit/src/chrome.ts; this adds the fixture page
// (test/browser/fixture), real pointer, touch and key input, and the page's
// errors in the order it reported them. A test file starts one Chrome, and
// each scenario opens in a browser context of its own.
import { afterAll, afterEach, inject } from "vitest";
import { type Chrome, type Page as ChromePage, launchChrome } from "testkit/chrome";

const WAIT_TIMEOUT_MS = 10_000;

const CHROME_ARGS = [
    // CI containers have no user namespaces for Chrome's sandbox;
    // the page is this suite's own fixture on loopback
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--mute-audio",
    // play() without a user gesture is refused, as in a panel
    "--autoplay-policy=document-user-activation-required",
    "--force-color-profile=srgb",
    // a wheel scrolls at once, so a test reads where it landed
    "--disable-smooth-scrolling",
];

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
    /** console.warn calls in the page, such as Solid's development warnings */
    readonly warnings: string[] = [];
    private readonly off: () => void;

    constructor(private readonly chrome: ChromePage) {
        this.off = chrome.on((msg) => {
            if (msg.method === "Runtime.exceptionThrown") {
                const details = msg.params.exceptionDetails;
                this.errors.push(details.exception?.description ?? details.text);
            } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
                this.errors.push(msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
            } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "warning") {
                this.warnings.push(msg.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
            }
        });
    }

    send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        return this.chrome.send<T>(method, params);
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

    /** Types `text` into the focused element, one keystroke's input per character. */
    async type(text: string) {
        for (const char of text) await this.send("Input.insertText", { text: char });
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
        await this.chrome.close();
    }
}

/** Opens one fixture scenario in a fresh browser context, ready once the scenario has mounted. */
async function openScenario(chrome: Chrome, scenario: string, options: PageOptions = {}): Promise<Page> {
    const page = new Page(await chrome.open("about:blank"));
    try {
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
    } catch (err) {
        await page.close();
        throw err;
    }
}

/**
 * The browser for one test file: one Chrome, started by the first `open`,
 * so a missing or broken Chrome fails every test with the reason instead of
 * leaving them unrun. After each test every page it opened is checked for
 * page errors and closed; after the file, Chrome is.
 */
export function useBrowser() {
    let chrome: Promise<Chrome> | null = null;
    let opened: Page[] = [];
    afterEach(async () => {
        const pages = opened;
        opened = [];
        try {
            const failures = pages.flatMap((page) => page.errors);
            if (failures.length) throw new Error(`the page reported errors:\n${failures.join("\n")}`);
        } finally {
            await Promise.all(pages.map((page) => page.close()));
        }
    });
    afterAll(async () => {
        if (chrome) await (await chrome).close();
    });
    return {
        async open(scenario: string, options?: PageOptions): Promise<Page> {
            chrome ??= launchChrome({ args: CHROME_ARGS });
            const page = await openScenario(await chrome, scenario, options);
            opened.push(page);
            return page;
        },
    };
}
