// Runs one of the panel's browser fixtures: bundles its page with Vite,
// serves it, loads it in headless Chrome and reads back the base64 JSON the
// fixture writes into #results as RESULT:<data>.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. A suite
// without it is skipped with a visible reason rather than passing silently.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { allowTestEndpoint } from "./hermetic";

const panelDir = resolve(import.meta.dir, "..");

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
        const found = Bun.which(candidate);
        if (found) return found;
    }
    return null;
}

export interface FixtureResults {
    checks: Record<string, unknown>;
    error: string;
}

async function buildFixture(page: string, alias: Record<string, string>, outDir: string): Promise<void> {
    const { build } = await import("vite");
    const solidPlugin = (await import("vite-plugin-solid")).default;
    await build({
        root: panelDir,
        configFile: false,
        logLevel: "error",
        plugins: [solidPlugin()],
        resolve: {
            alias: Object.entries(alias).map(([name, file]) => ({
                find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`),
                replacement: join(panelDir, file),
            })),
            dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
        },
        build: {
            outDir,
            emptyOutDir: true,
            minify: false,
            rollupOptions: { input: join(panelDir, page) },
            codeSplitting: false,
        },
    });
}

// Real time, for what only happens on a rendered frame (ResizeObserver,
// Web Animations): under --virtual-time-budget frames don't run. Chrome is
// driven over its DevTools socket and #results is read once it's written.
async function readInRealTime(chrome: string, url: string, profile: string): Promise<string> {
    const proc = Bun.spawn(
        [
            chrome,
            "--headless=new",
            `--user-data-dir=${profile}`,
            "--remote-debugging-port=0",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-background-networking",
            "--no-first-run",
            "--hide-scrollbars",
            "--window-size=1280,800",
            url,
        ],
        { stdout: "ignore", stderr: "pipe" },
    );
    try {
        let stderr = "";
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        let port = "";
        while (!port) {
            const { value, done } = await reader.read();
            if (done) throw new Error(`headless Chrome exited before its DevTools socket opened: ${stderr.slice(0, 400)}`);
            stderr += decoder.decode(value);
            port = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr)?.[1] ?? "";
        }
        const deadline = Date.now() + 60_000;
        let target: { webSocketDebuggerUrl: string } | undefined;
        while (!target && Date.now() < deadline) {
            const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
            target = list.find((t) => t.type === "page" && t.url.startsWith(url));
            if (!target) await Bun.sleep(100);
        }
        if (!target) throw new Error("headless Chrome never opened the fixture page");
        // the Chrome this test started, on loopback: the one socket it may open
        const disallow = allowTestEndpoint(target.webSocketDebuggerUrl);
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        disallow();
        await new Promise((resolve, reject) => {
            socket.onopen = resolve;
            socket.onerror = () => reject(new Error("the fixture page's DevTools socket failed"));
        });
        let id = 0;
        const read = () =>
            new Promise<string>((resolve) => {
                const ask = ++id;
                socket.onmessage = (event) => {
                    const reply = JSON.parse(String(event.data));
                    if (reply.id === ask) resolve(String(reply.result?.result?.value ?? ""));
                };
                socket.send(JSON.stringify({ id: ask, method: "Runtime.evaluate", params: { expression: `document.getElementById("results")?.textContent ?? ""` } }));
            });
        while (Date.now() < deadline) {
            const text = await read();
            if (text.startsWith("RESULT:")) {
                socket.close();
                return text;
            }
            await Bun.sleep(100);
        }
        throw new Error("the fixture didn't write its results within a minute");
    } finally {
        proc.kill();
        await proc.exited;
    }
}

/**
 * `page` is the fixture's HTML, relative to the panel; `alias` swaps a
 * package for a panel file, e.g. PaperUI for a DOM stub. `realTime` runs
 * it with rendered frames instead of under a virtual time budget.
 */
export async function runBrowserFixture(
    chrome: string,
    page: string,
    alias: Record<string, string>,
    options: { realTime?: boolean } = {},
): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-agents-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
        await buildFixture(page, alias, dist);
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
                const url = new URL(request.url);
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/")) {
                    return new Response("not found", { status: 404 });
                }
                // a directory (Chrome asks for "/" on its own) is no file to serve
                if (!existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
                const blob = Bun.file(file);
                if (blob.size === 0) return new Response("not found", { status: 404 });
                return new Response(blob);
            },
        });
        if (options.realTime) {
            const text = await readInRealTime(chrome, `http://127.0.0.1:${server.port}/${page}`, join(dir, "profile"));
            return JSON.parse(Buffer.from(text.slice("RESULT:".length), "base64").toString("utf8")) as FixtureResults;
        }
        // serve while Chrome runs: spawn must not block this event loop
        const proc = Bun.spawn(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--hide-scrollbars",
                "--window-size=1280,800",
                "--virtual-time-budget=15000",
                "--dump-dom",
                `http://127.0.0.1:${server.port}/${page}`,
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        const killTimer = setTimeout(() => proc.kill(), 60_000);
        const [dom, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
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
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}
