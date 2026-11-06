// @vitest-environment node
// Real-browser contract for the library's icons (headless Chrome): icons are
// ligatures in PaperUI's icon font, so a page painted before the font loads
// shows "chevron_left" and "download" as words. The built library is served
// as Origami serves it, with a stub registry and an icon font held back so
// the race is real, and a probe watches every frame of a panel's page: one
// opened fresh, and one reached from the grid. jsdom loads no fonts, so only
// a real browser can see it. Without Chrome the test is skipped, visibly.
import { describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const libraryDir = resolve(import.meta.dirname, "..");
const PANEL_ID = "dev.fixture.panel";
// long enough that a page painting without waiting for the font is caught
const FONT_DELAY_MS = 800;

function findChrome(): string | null {
    const candidates = [process.env.PAPERBOARD_CHROME, process.env.CHROME_BIN, "google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]
        .filter((c): c is string => Boolean(c));
    for (const candidate of candidates) {
        if (candidate.includes("/")) {
            if (existsSync(candidate)) return candidate;
            continue;
        }
        for (const dir of (process.env.PATH ?? "").split(":")) {
            if (dir && existsSync(join(dir, candidate))) return join(dir, candidate);
        }
    }
    return null;
}

const REGISTRY = {
    [PANEL_ID]: {
        name: "Fixture Panel",
        version: "1.0.0",
        description: "A panel for the icon font test",
        publisher: "Paperboard",
        icon: "extension",
    },
};

// Runs in the page before the app: every animation frame, is the library on
// screen, does it show an icon's name, and has the icon font loaded?
const PROBE = `
(() => {
    const out = { checks: {}, error: "" };
    const ICON_FONT = '1em "Material Symbols Rounded"';
    const fromGrid = new URLSearchParams(location.search).get("probe") === "grid";
    const root = () => document.querySelector(".paperui-root");
    const shown = () => { const r = root(); return Boolean(r) && getComputedStyle(r).opacity !== "0"; };
    const onPanelPage = () => Boolean(document.querySelector('nav[aria-label="Breadcrumb"]'));
    const words = [];
    let clicked = false;
    let settled = 0;
    let frames = 0;
    const frame = () => {
        frames++;
        const fontLoaded = document.fonts.check(ICON_FONT);
        if (shown() && onPanelPage() && !fontLoaded) words.push(frames);
        if (fromGrid && !clicked && shown()) {
            const card = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "Fixture Panel");
            if (card) { clicked = true; card.click(); }
        }
        if (shown() && onPanelPage() && fontLoaded) settled++;
        if (settled > 10 || frames > 1200) return finish();
        requestAnimationFrame(frame);
    };
    const finish = () => {
        out.checks.reachedPanelPage = onPanelPage();
        out.checks.fontLoaded = document.fonts.check(ICON_FONT);
        out.checks.framesShowingIconNames = words;
        void fetch("/results", { method: "POST", body: JSON.stringify(out) });
    };
    addEventListener("error", (e) => { out.error = String(e.message); });
    requestAnimationFrame(frame);
})();
`;

const TYPES: Record<string, string> = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp", ".json": "application/json",
};

async function runLibrary(chrome: string, search: string): Promise<{ checks: Record<string, unknown>; error: string }> {
    const dir = mkdtempSync(join(tmpdir(), "library-icon-font-"));
    let server: Server | undefined;
    let proc: ChildProcess | undefined;
    try {
        const { build } = await import("vite");
        await build({
            root: libraryDir,
            configFile: join(libraryDir, "vite.config.ts"),
            logLevel: "error",
            build: { outDir: join(dir, "dist", "library"), emptyOutDir: true },
        });
        const dist = join(dir, "dist");
        let posted!: (value: { checks: Record<string, unknown>; error: string }) => void;
        const results = new Promise<{ checks: Record<string, unknown>; error: string }>((done) => { posted = done; });
        server = createServer((req, res) => {
            const { pathname } = new URL(req.url ?? "/", "http://localhost");
            if (pathname === "/results" && req.method === "POST") {
                let body = "";
                req.on("data", (chunk) => { body += chunk; });
                req.on("end", () => { posted(JSON.parse(body)); res.end("done"); });
                return;
            }
            if (pathname === "/panels/index.json") {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify(REGISTRY));
                return;
            }
            if (pathname === "/library/probe.js") {
                res.setHeader("content-type", "text/javascript");
                res.end(PROBE);
                return;
            }
            const file = join(dist, pathname.endsWith("/") ? `${pathname}index.html` : pathname);
            if (!file.startsWith(`${dist}/`) || !existsSync(file) || !statSync(file).isFile()) {
                res.statusCode = 404;
                res.end("not found");
                return;
            }
            let body: Buffer | string = readFileSync(file);
            if (file.endsWith("index.html")) {
                // the probe runs first, a classic script before the app's module
                body = body.toString().replace("<head>", '<head><script src="/library/probe.js"></script>');
            }
            res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
            const send = () => res.end(body);
            if (/MaterialSymbols/.test(file)) setTimeout(send, FONT_DELAY_MS);
            else send();
        });
        await new Promise<void>((ready) => server?.listen(0, "127.0.0.1", ready));
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("the fixture server has no port");
        proc = spawn(chrome, [
            "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking",
            "--no-first-run", "--hide-scrollbars", "--window-size=1280,800", `--user-data-dir=${join(dir, "chrome")}`,
            `http://127.0.0.1:${address.port}/library/${search}`,
        ], { stdio: "ignore" });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("the library posted no results within 45 s")), 45_000);
        });
        try {
            return await Promise.race([results, timeout]);
        } finally {
            clearTimeout(timer);
        }
    } finally {
        proc?.kill();
        server?.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

const chrome = findChrome();
if (!chrome) console.warn("iconFont.browser: skipped, no Chrome found (set PAPERBOARD_CHROME)");

describe.skipIf(!chrome)("the library's icons in a real browser", () => {
    test("a panel's page opened fresh never shows an icon's name", async () => {
        const { checks, error } = await runLibrary(chrome as string, `?panel=${PANEL_ID}`);
        expect(error).toBe("");
        expect(checks).toEqual({ reachedPanelPage: true, fontLoaded: true, framesShowingIconNames: [] });
    }, 90_000);

    test("a panel's page opened from the grid never shows an icon's name", async () => {
        const { checks, error } = await runLibrary(chrome as string, "?probe=grid");
        expect(error).toBe("");
        expect(checks).toEqual({ reachedPanelPage: true, fontLoaded: true, framesShowingIconNames: [] });
    }, 90_000);
});
