// Runs one of the panel's browser fixtures (test/fixtures/*.html): a page of
// the panel's own components over a stubbed SDK, with no service behind it.
// It bundles the page with Vite, serves it, opens it in headless Chrome
// (scripts/testing/chrome.ts, which finds Chrome and says how to install it
// when there is none) and waits for the JSON the fixture posts back to
// /result (fixtures/chatPage.tsx `report`).
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChrome, type Page } from "../../../scripts/testing/chrome";
import { allowTestPort } from "./hermetic";

const panelDir = resolve(import.meta.dir, "..");
/** How long a fixture gets, from its page loading to its result. */
const FIXTURE_TIMEOUT_MS = 90_000;

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
export async function runBrowserFixture(page: string, alias: Record<string, string>): Promise<FixtureResults> {
    const dir = mkdtempSync(join(tmpdir(), "pb-agents-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    let chrome: Page | undefined;
    const disallow: (() => void)[] = [];
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
        chrome = await openChrome(`http://127.0.0.1:${server.port}/${page}`, { onPort: (port) => disallow.push(allowTestPort(port)) });
        const loaded = chrome;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            reported,
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        clearTimeout(timer);
        if (typeof outcome === "string") throw new Error(`${outcome}: ${JSON.stringify({ exceptions: loaded.exceptions, consoleErrors: loaded.consoleErrors }).slice(0, 800)}`);
        return outcome;
    } finally {
        await chrome?.close();
        for (const undo of disallow) undo();
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}
