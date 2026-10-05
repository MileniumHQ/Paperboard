// Shared loader for the real-browser (headless Chrome) PaperUI fixtures.
//
// The browser suites exist for defects jsdom cannot see: computed CSS, hit
// testing, and real layout. A fixture is a tiny Solid app that mounts the
// published components, drives the browser, and reports its checks as a
// base64 RESULT: line in the DOM. This module builds, serves, and harvests
// that result. Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or
// PATH; callers skip visibly when it is absent.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";

export interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

// import.meta.url is not a file: URL under vitest, so the package root is
// found by walking up from the working directory instead.
export function findPackageDir(): string {
    let dir = process.cwd();
    for (let i = 0; i < 5; i += 1) {
        const manifest = join(dir, "package.json");
        if (existsSync(manifest)) {
            const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
                name?: string;
            };
            if (parsed.name === "@mileniumhq/paperui") return dir;
        }
        dir = dirname(dir);
    }
    throw new Error(
        `could not locate @mileniumhq/paperui from ${process.cwd()}`,
    );
}

function findOnPath(name: string): string | null {
    for (const dir of (process.env.PATH ?? "").split(":")) {
        if (!dir) continue;
        const candidate = join(dir, name);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

export function findChrome(): string | null {
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

async function buildFixture(
    packageDir: string,
    fixtureHtml: string,
    outDir: string,
): Promise<void> {
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
                input: join(packageDir, fixtureHtml),
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

/**
 * Build and load a fixture, then return its reported checks.
 * `fixtureHtml` is the path to the fixture's HTML entry, relative to the
 * package root (e.g. "src/__tests__/fixtures/menuFixture.html").
 */
export async function runFixture(
    chrome: string,
    fixtureHtml: string,
): Promise<FixtureResults> {
    const packageDir = findPackageDir();
    const dir = mkdtempSync(join(tmpdir(), "paperui-browser-"));
    const dist = join(dir, "dist");
    let server: Server | undefined;
    try {
        await buildFixture(packageDir, fixtureHtml, dist);
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
                `http://127.0.0.1:${started.port}/${fixtureHtml}`,
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
