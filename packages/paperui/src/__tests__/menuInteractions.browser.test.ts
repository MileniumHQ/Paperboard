// Real-browser contract for menu presses (headless Chrome).
//
// PaperUI's menu failures live in the gap jsdom leaves: jsdom dispatches a
// click on a display:none element, so a suite can pass while a real option
// click dies when the press already dismissed the popup. This test bundles
// the real components into a fixture, serves it, and lets Chrome run the
// press/release/click sequence through its own hit testing.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. When it is
// unavailable the test is skipped with a visible reason rather than passing
// silently.
import { describe, test, expect } from "vitest";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";

// import.meta.url is not a file: URL under vitest, so the package root is
// found by walking up from the working directory instead.
function findPackageDir(): string {
    let dir = process.cwd();
    for (let i = 0; i < 5; i += 1) {
        const manifest = join(dir, "package.json");
        if (existsSync(manifest)) {
            const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
                name?: string;
            };
            if (parsed.name === "@paperboard-dev/paperui") return dir;
        }
        dir = dirname(dir);
    }
    throw new Error(
        `could not locate @paperboard-dev/paperui from ${process.cwd()}`,
    );
}

const packageDir = findPackageDir();

interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

function findOnPath(name: string): string | null {
    for (const dir of (process.env.PATH ?? "").split(":")) {
        if (!dir) continue;
        const candidate = join(dir, name);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function findChrome(): string | null {
    const candidates = [
        process.env.PAPERBOARD_CHROME,
        process.env.CHROME_BIN,
        "google-chrome-stable",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ].filter((c): c is string => Boolean(c));
    for (const candidate of candidates) {
        if (candidate.includes("/")) {
            if (existsSync(candidate)) return candidate;
            continue;
        }
        const found = findOnPath(candidate);
        if (found) return found;
    }
    return null;
}

async function buildFixture(outDir: string): Promise<void> {
    const { build } = await import("vite");
    const solidPlugin = (await import("vite-plugin-solid")).default;
    await build({
        root: packageDir,
        configFile: false,
        logLevel: "error",
        plugins: [solidPlugin()],
        build: {
            outDir,
            emptyOutDir: true,
            minify: false,
            rollupOptions: {
                input: join(
                    packageDir,
                    "src/__tests__/fixtures/menuFixture.html",
                ),
            },
        },
    });
}

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
};

function startServer(distDir: string): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const file = join(distDir, decodeURIComponent(url.pathname));
        if (!file.startsWith(distDir + "/")) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        try {
            const body = readFileSync(file);
            res.writeHead(200, {
                "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end("not found");
        }
    });
    return new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("fixture server did not bind a port"));
                return;
            }
            resolvePromise({ server, port: address.port });
        });
    });
}

async function readStream(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function runFixture(chrome: string): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "paperui-menu-browser-"));
    const dist = join(dir, "dist");
    let server: Server | undefined;
    try {
        await buildFixture(dist);
        const started = await startServer(dist);
        server = started.server;
        const proc = spawn(
            chrome,
            [
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--hide-scrollbars",
                "--window-size=1280,800",
                "--virtual-time-budget=8000",
                "--dump-dom",
                `http://127.0.0.1:${started.port}/src/__tests__/fixtures/menuFixture.html`,
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
        );
        const exitCodePromise = new Promise<number | null>((resolvePromise) => {
            proc.once("exit", (code) => resolvePromise(code));
        });
        const killTimer = setTimeout(() => proc.kill(), 30_000);
        const [dom, stderr] = await Promise.all([
            readStream(proc.stdout),
            readStream(proc.stderr),
        ]);
        const exitCode = await exitCodePromise;
        clearTimeout(killTimer);
        const match = dom.match(/RESULT:([A-Za-z0-9+/=]+)/);
        if (!match) {
            throw new Error(
                `headless Chrome produced no result (exit ${exitCode}): ${stderr.slice(0, 400)}`,
            );
        }
        return JSON.parse(
            Buffer.from(match[1], "base64").toString("utf8"),
        ) as FixtureResults;
    } finally {
        server?.close();
        rmSync(dir, { recursive: true, force: true });
    }
}

const chrome = findChrome();
const browserTest = chrome ? test : test.skip;

describe("menu presses in a real browser", () => {
    browserTest(
        chrome
            ? "a press on a select option or context menu item survives to its click (headless Chrome)"
            : "a press on a select option or context menu item survives to its click (skipped: no Chrome)",
        async () => {
            if (!chrome) return;
            const results = await runFixture(chrome);
            expect(results.error, "the fixture threw").toBe("");
            const checks = results.checks;

            expect(checks.selectOpened, "the trigger click did not open the listbox").toBe(true);
            expect(
                checks.popupOpenAfterOptionPress,
                "the press on the option dismissed the popup before its click",
            ).toBe(true);
            expect(checks.selectCommitted, "the option click did not commit").toBe("beta");
            expect(checks.triggerLabel, "the trigger did not show the chosen option").toContain("Beta");
            expect(checks.selectClosedAfterOption, "the popup stayed open after committing").toBe(true);

            expect(checks.contextMenuOpened, "right click did not open the context menu").toBe(true);
            expect(checks.contextItemClicks, "the context menu item click did not run").toBe(1);
            expect(checks.contextMenuClosedAfterItem, "the context menu stayed open after its item click").toBe(true);
        },
        60_000,
    );
});
