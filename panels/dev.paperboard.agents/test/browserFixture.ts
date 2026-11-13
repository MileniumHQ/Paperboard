// Runs one of the panel's browser fixtures (the same as the Blocks panel's): bundles its page with Vite,
// serves it, opens it in headless Chrome and waits for the JSON the fixture
// posts back to /result. The page runs in real time, as Blockly draws on
// animation frames.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const panelDir = resolve(import.meta.dir, "..");
/** How long a fixture gets, from Chrome starting to its result. */
const FIXTURE_TIMEOUT_MS = 90_000;

export function findChrome(): string | null {
    const candidates = [process.env.PAPERBOARD_CHROME, process.env.CHROME_BIN, "google-chrome-stable", "google-chrome", "chromium", "chromium-browser"].filter((c): c is string => Boolean(c));
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
    checks: Record<string, any>;
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
        build: { outDir, emptyOutDir: true, minify: false, rollupOptions: { input: join(panelDir, page) } },
    });
}

/**
 * `page` is the fixture's HTML, relative to the panel; `alias` swaps a
 * package for a panel file, e.g. the SDK for one with no daemon behind it.
 */
export async function runBrowserFixture(chrome: string, page: string, alias: Record<string, string>): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-agents-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    let proc: ReturnType<typeof Bun.spawn> | undefined;
    try {
        await buildFixture(page, alias, dist);
        let report!: (results: FixtureResults) => void;
        const reported = new Promise<FixtureResults>((done) => (report = done));
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
                const url = new URL(request.url);
                if (request.method === "POST" && url.pathname === "/result") {
                    report((await request.json()) as FixtureResults);
                    return new Response("ok");
                }
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/") || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
                return new Response(Bun.file(file));
            },
        });
        proc = Bun.spawn(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--window-size=1400,900",
                `--user-data-dir=${join(dir, "chrome")}`,
                `http://127.0.0.1:${server.port}/${page}`,
            ],
            { stdout: "ignore", stderr: "pipe" },
        );
        const stderr = new Response(proc.stderr as ReadableStream).text();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            reported,
            proc.exited.then((code) => `headless Chrome exited (${code}) before the fixture reported`),
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        clearTimeout(timer);
        if (typeof outcome === "string") {
            proc.kill();
            throw new Error(`${outcome}: ${(await stderr).slice(0, 400)}`);
        }
        return outcome;
    } finally {
        proc?.kill();
        await proc?.exited;
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}
