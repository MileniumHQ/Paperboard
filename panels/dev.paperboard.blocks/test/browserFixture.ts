// Runs one of the panel's browser fixtures: bundles its page with Vite,
// serves it, opens it in headless Chrome and waits for the JSON the fixture
// posts back to /result. The page runs in real time, as Blockly draws on
// animation frames.
//
// A fixture that needs a person's own input (a key that also presses the
// button focus lands on, typing into whatever has the keyboard) posts the
// DevTools Input calls to /input: Chrome delivers them as trusted events,
// which a page's own dispatchEvent can't make. DevTools is reached over a
// pipe, so no port is opened.
//
// Chrome is discovered via PAPERBOARD_CHROME / CHROME_BIN or PATH.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
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
    const dir = mkdtempSync(join(tmpdir(), "paperboard-blocks-fixture-"));
    const dist = join(dir, "dist");
    let server: ReturnType<typeof Bun.serve> | undefined;
    let proc: ChildProcess | undefined;
    let exited: Promise<number | null> = Promise.resolve(null);
    try {
        await buildFixture(page, alias, dist);
        let report!: (results: FixtureResults) => void;
        const reported = new Promise<FixtureResults>((done) => (report = done));
        let devtools: DevTools | undefined;
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
                    if (!devtools) throw new Error("Chrome is not open");
                    for (const call of calls) {
                        if (!call.method.startsWith("Input.")) throw new Error(`a fixture sends only Input calls, not ${call.method}`);
                        await devtools.page(call.method, call.params);
                    }
                    return new Response("ok");
                }
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/") || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
                return new Response(Bun.file(file));
            },
            error: (err) => new Response(String(err), { status: 500 }),
        });
        proc = spawn(
            chrome,
            [
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-background-networking",
                "--no-first-run",
                "--remote-debugging-pipe",
                "--window-size=1400,900",
                `--user-data-dir=${join(dir, "chrome")}`,
                `http://127.0.0.1:${server.port}/${page}`,
            ],
            { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
        );
        exited = new Promise((done) => proc!.once("exit", (code) => done(code)));
        let stderr = "";
        proc.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
        devtools = new DevTools(proc.stdio[3] as Writable, proc.stdio[4] as Readable);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            reported,
            exited.then((code) => `headless Chrome exited (${code}) before the fixture reported`),
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        clearTimeout(timer);
        if (typeof outcome === "string") throw new Error(`${outcome}: ${stderr.slice(0, 400)}`);
        return outcome;
    } finally {
        if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill();
        await exited;
        server?.stop(true);
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Chrome's DevTools over --remote-debugging-pipe: JSON messages, each ended by a NUL. */
class DevTools {
    private nextId = 1;
    private pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
    private buffer = "";
    private session: Promise<string> | undefined;

    constructor(
        private input: Writable,
        output: Readable,
    ) {
        output.on("data", (chunk: Buffer) => {
            this.buffer += chunk.toString("utf8");
            let end: number;
            while ((end = this.buffer.indexOf("\0")) >= 0) {
                const message = JSON.parse(this.buffer.slice(0, end));
                this.buffer = this.buffer.slice(end + 1);
                const waiting = message.id ? this.pending.get(message.id) : undefined;
                if (!waiting) continue;
                this.pending.delete(message.id);
                if (message.error) waiting.reject(new Error(`DevTools ${message.error.message}`));
                else waiting.resolve(message.result);
            }
        });
    }

    private send<T = any>(method: string, params: Record<string, unknown>, sessionId?: string): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
        });
    }

    /** A call to the fixture's page (the one page Chrome opened). */
    async page<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
        this.session ??= (async () => {
            const { targetInfos } = await this.send<{ targetInfos: { type: string; targetId: string }[] }>("Target.getTargets", {});
            const target = targetInfos.find((t) => t.type === "page");
            if (!target) throw new Error("Chrome has no page open");
            const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId: target.targetId, flatten: true });
            return sessionId;
        })();
        return this.send<T>(method, params, await this.session);
    }
}
