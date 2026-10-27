// Runs one of the shell's browser fixtures: bundles its page with Vite,
// serves it, loads it in headless Chrome and waits for the JSON the page
// POSTs to /results. Real time, not Chrome's virtual time: the shell's
// fixtures talk to a real PaperCrane, whose sockets virtual time races past.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH. A suite
// without it is skipped with a visible reason rather than passing silently.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");

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

/**
 * `page` is the fixture's HTML, relative to the app, with any query it
 * needs. The page can ask the test to act mid-run by fetching
 * `/control/<name>`: `control` runs it and answers once it's done.
 */
export async function runBrowserFixture(
    chrome: string,
    page: string,
    control?: (name: string) => Promise<void>,
): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-shell-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    let chromeProc: ReturnType<typeof Bun.spawn> | undefined;
    let posted!: (results: FixtureResults) => void;
    const results = new Promise<FixtureResults>((resolve) => { posted = resolve; });
    try {
        const { build } = await import("vite");
        const solidPlugin = (await import("vite-plugin-solid")).default;
        await build({
            root: appDir,
            configFile: false,
            logLevel: "error",
            plugins: [solidPlugin()],
            resolve: { dedupe: ["solid-js", "solid-js/web", "solid-js/store"] },
            build: {
                outDir: dist,
                emptyOutDir: true,
                minify: false,
                rollupOptions: { input: join(appDir, page.split("?")[0]) },
            },
        });
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
                const { pathname } = new URL(request.url);
                if (pathname === "/results" && request.method === "POST") {
                    posted((await request.json()) as FixtureResults);
                    return new Response("done");
                }
                if (pathname.startsWith("/control/")) {
                    if (!control) return new Response("no control", { status: 404 });
                    await control(pathname.slice("/control/".length));
                    return new Response("done");
                }
                const file = join(dist, pathname);
                if (!file.startsWith(dist + "/")) return new Response("not found", { status: 404 });
                const blob = Bun.file(file);
                if (blob.size === 0) return new Response("not found", { status: 404 });
                return new Response(blob);
            },
        });
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
                `--user-data-dir=${join(dir, "chrome")}`,
                `http://127.0.0.1:${server.port}/${page}`,
            ],
            { stdout: "ignore", stderr: "pipe" },
        );
        chromeProc = proc;
        const exited = proc.exited.then(async (code) => {
            const stderr = await new Response(proc.stderr as ReadableStream).text();
            throw new Error(`headless Chrome exited (${code}) before the page posted results: ${stderr.slice(0, 400)}`);
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("the page posted no results within 60 s")), 60_000);
        });
        try {
            return await Promise.race([results, exited, timeout]);
        } finally {
            clearTimeout(timer);
        }
    } finally {
        chromeProc?.kill();
        await chromeProc?.exited;
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}
