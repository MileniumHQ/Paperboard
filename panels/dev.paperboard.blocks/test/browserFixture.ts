// Runs one of the panel's browser fixtures: bundles its page with Vite,
// serves it, opens it in headless Chrome (scripts/testing/chrome.ts) and
// waits for the JSON the fixture posts back to /result. The page runs in
// real time, as Blockly draws on animation frames.
//
// A fixture that needs a person's own input (a key that also presses the
// button focus lands on, typing into whatever has the keyboard) posts the
// DevTools Input calls to /input: Chrome delivers them as trusted events,
// which a page's own dispatchEvent can't make. A fixture's /screenshot saves
// what the page shows at a size into BLOCKS_FIXTURE_SHOTS, when that is set.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChrome, type Page } from "../../../scripts/testing/chrome";

const panelDir = resolve(import.meta.dir, "..");
// the DevTools ports test/hermetic.ts lets a WebSocket reach
const allowedPorts: Set<number> = (globalThis as any)[Symbol.for("paperboard.blocks.test.ports")];
// where a fixture's screenshots go, for a person to look at; none are taken without it
const shots = process.env.BLOCKS_FIXTURE_SHOTS ? resolve(process.env.BLOCKS_FIXTURE_SHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });
/** How long a fixture gets, from Chrome starting to its result. */
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
    const dir = mkdtempSync(join(tmpdir(), "paperboard-blocks-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    let chrome: Page | undefined;
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
                if (request.method === "POST" && url.pathname === "/input") {
                    const { calls } = (await request.json()) as { calls: { method: string; params: Record<string, unknown> }[] };
                    if (!chrome) throw new Error("Chrome is not open");
                    for (const call of calls) {
                        if (!call.method.startsWith("Input.")) throw new Error(`a fixture sends only Input calls, not ${call.method}`);
                        await chrome.send(call.method, call.params);
                    }
                    return new Response("ok");
                }
                if (request.method === "POST" && url.pathname === "/screenshot") {
                    const { name, width, height } = (await request.json()) as { name: string; width: number; height: number };
                    if (!chrome) throw new Error("Chrome is not open");
                    if (!shots) return new Response("ok");
                    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" is not a screenshot name`);
                    await chrome.resize(width, height);
                    writeFileSync(join(shots, `${name}.png`), await chrome.screenshot());
                    await chrome.send("Emulation.clearDeviceMetricsOverride");
                    return new Response("ok");
                }
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/") || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
                return new Response(Bun.file(file));
            },
            error: (err) => new Response(String(err), { status: 500 }),
        });
        chrome = await openChrome(`http://127.0.0.1:${server.port}/${page}`, { onPort: (port) => allowedPorts.add(port) });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            reported,
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        clearTimeout(timer);
        if (typeof outcome === "string") throw new Error(`${outcome}; the page threw: ${JSON.stringify(chrome.exceptions)}`);
        return outcome;
    } finally {
        await chrome?.close();
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}
