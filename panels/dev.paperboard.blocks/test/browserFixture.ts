// The panel's browser fixtures: their pages are bundled with Vite in one
// build, served, and opened together in one headless Chrome
// (scripts/testing/chrome.ts), each in a browser context of its own; each
// page posts the JSON of what it saw back to /result. The pages run in real
// time, as Blockly draws on animation frames. The first file to ask starts
// them all, and every file shares their results.
//
// A fixture that needs a person's own input (a key that also presses the
// button focus lands on, typing into whatever has the keyboard) posts the
// DevTools Input calls to /input: Chrome delivers them as trusted events,
// which a page's own dispatchEvent can't make. A fixture's /screenshot saves
// what the page shows at a size into BLOCKS_FIXTURE_SHOTS, when that is set.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchChrome, type Chrome, type Page } from "../../../scripts/testing/chrome";

const panelDir = resolve(import.meta.dir, "..");
// the DevTools ports test/hermetic.ts lets a WebSocket reach
const allowedPorts: Set<number> = (globalThis as any)[Symbol.for("paperboard.blocks.test.ports")];
// where a fixture's screenshots go, for a person to look at; none are taken without it
const shots = process.env.BLOCKS_FIXTURE_SHOTS ? resolve(process.env.BLOCKS_FIXTURE_SHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });
/** How long a fixture gets, from its page opening to its result. */
const FIXTURE_TIMEOUT_MS = 90_000;

/** Each fixture's page, relative to the panel. Every page sees the SDK as test/fixtures/serviceStub.ts. */
const PAGES = {
    /** the editor, with blocks dragged about in it (test/fixtures/editorFixture.tsx) */
    editor: "test/fixtures/editorFixture.html",
    /** the whole panel, over a service announcing its state (test/fixtures/panelFixture.tsx) */
    panel: "test/fixtures/panelFixture.html",
};
export type FixtureName = keyof typeof PAGES;

export interface FixtureResults {
    checks: Record<string, any>;
    error: string;
}

async function build(outDir: string): Promise<void> {
    const { build } = await import("vite");
    const solidPlugin = (await import("vite-plugin-solid")).default;
    await build({
        root: panelDir,
        configFile: false,
        logLevel: "error",
        plugins: [solidPlugin()],
        resolve: {
            alias: [{ find: /^@mileniumhq\/paperapi$/, replacement: join(panelDir, "test/fixtures/serviceStub.ts") }],
            dedupe: ["solid-js", "solid-js/web", "solid-js/store"],
        },
        build: { outDir, emptyOutDir: true, minify: false, rollupOptions: { input: Object.values(PAGES).map((page) => join(panelDir, page)) } },
    });
}

/** Serves the build to one page, and waits for what that page reports. */
async function runPage(chrome: Chrome, dist: string, page: string): Promise<FixtureResults> {
    let tab: Page | undefined;
    let report!: (results: FixtureResults) => void;
    const reported = new Promise<FixtureResults>((done) => (report = done));
    const server = Bun.serve({
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
                if (!tab) throw new Error("The page is not open");
                for (const call of calls) {
                    if (!call.method.startsWith("Input.")) throw new Error(`a fixture sends only Input calls, not ${call.method}`);
                    await tab.send(call.method, call.params);
                }
                return new Response("ok");
            }
            if (request.method === "POST" && url.pathname === "/screenshot") {
                const { name, width, height } = (await request.json()) as { name: string; width: number; height: number };
                if (!tab) throw new Error("The page is not open");
                if (!shots) return new Response("ok");
                if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" is not a screenshot name`);
                await tab.resize(width, height);
                writeFileSync(join(shots, `${name}.png`), await tab.screenshot());
                await tab.send("Emulation.clearDeviceMetricsOverride");
                return new Response("ok");
            }
            const file = join(dist, url.pathname);
            if (!file.startsWith(dist + "/") || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
            return new Response(Bun.file(file));
        },
        error: (err) => new Response(String(err), { status: 500 }),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        tab = await chrome.open(`http://127.0.0.1:${server.port}/${page}`);
        const outcome = await Promise.race([
            reported,
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        if (typeof outcome === "string") throw new Error(`${outcome}; the page threw: ${JSON.stringify(tab.exceptions)}`);
        return outcome;
    } finally {
        clearTimeout(timer);
        await tab?.close();
        server.stop(true);
    }
}

/** Builds the pages, opens them all at once, and closes Chrome once every one has reported. */
function runAll(): Record<FixtureName, Promise<FixtureResults>> {
    const dir = mkdtempSync(join(tmpdir(), "paperboard-blocks-fixture-"));
    const dist = join(dir, "dist");
    const ready = Promise.all([build(dist), launchChrome({ onPort: (port) => allowedPorts.add(port) })]);
    const runs = Object.fromEntries(Object.entries(PAGES).map(([name, page]) => [name, ready.then(([, chrome]) => runPage(chrome, dist, page))])) as Record<FixtureName, Promise<FixtureResults>>;
    void Promise.allSettled([ready, ...Object.values(runs)]).then(async ([started]) => {
        if (started!.status === "fulfilled") await started.value[1].close();
        rmSync(dir, { recursive: true, force: true });
    });
    return runs;
}

let runs: Record<FixtureName, Promise<FixtureResults>> | undefined;
/** What fixture `name` saw, run once per test process. */
export function browserFixture(name: FixtureName): Promise<FixtureResults> {
    runs ??= runAll();
    return runs[name];
}
