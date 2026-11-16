// The panel's browser fixtures: pages of the panel's own code (test/fixtures/
// *Fixture.html) over the real SDK, the real Blocks service and a real
// daemon (test/helpers/crane.ts), in headless Chrome (scripts/testing/
// chrome.ts). The pages are bundled with Vite in one build and opened
// together, each in a browser context of its own, over a daemon and service
// started for it with the projects it needs; each posts the JSON of what it
// saw back to /result.
//
// Each page is framed by a stand-in for the shell, which challenges it as
// Paperboard does and keeps what it says of its unsaved work. Before the
// page's own scripts, the page is given its crane credentials and a hold on
// its socket (WIRE below): the calls it sent, a call refused for real by
// sending it for a project the service doesn't have, a daemon request
// refused for real by asking it for a panel that isn't there, a listing's answer held
// until released. What lies outside the page (another panel, another window,
// the service logging, the registry going away) the page asks the test for
// at /ask (fixtures/wire.ts).
//
// A fixture that needs a person's own input (a key that also presses the
// button focus lands on, typing into whatever has the keyboard) posts the
// DevTools Input calls to /input: Chrome delivers them as trusted events,
// which a page's own dispatchEvent can't make. A fixture's /screenshot saves
// what the page shows at a size into BLOCKS_FIXTURE_SHOTS, when that is set,
// and its /viewport lays the page out as a window resized to a size.
//
// The pages run in real time, as Blockly draws on animation frames. The
// first file to ask starts them all, and every file shares their results.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchChrome, type Chrome, type Page } from "../../../scripts/testing/chrome";
import { BUILTIN, registryBlockType } from "../src/lib/names";
import { PANEL_ID, type SavedFlows } from "../src/panel";
import { PROJECTS_FILE, PROJECTS_VERSION } from "../src/lib/projects";
import { ABSENT_PANEL, FIXTURE_PANEL, FIXTURE_PANEL_NAME, LATE_PANEL, LATE_PANEL_NAME, REFUSED_PROJECT, REGISTRY_AWAY, SERVICED, SERVICED_PROJECT } from "./fixtures/world";
import { startBlocksService, startDaemon, startOtherPanel, type BlocksService, type OtherPanel, type Seed, type TestDaemon } from "./helpers/crane";

const panelDir = resolve(import.meta.dir, "..");
// the DevTools ports test/hermetic.ts lets a WebSocket reach
const allowedPorts: Set<number> = (globalThis as any)[Symbol.for("paperboard.blocks.test.ports")];
// where a fixture's screenshots go, for a person to look at; none are taken without it
const shots = process.env.BLOCKS_FIXTURE_SHOTS ? resolve(process.env.BLOCKS_FIXTURE_SHOTS) : null;
if (shots) mkdirSync(shots, { recursive: true });
/** How long a fixture gets, from its page opening to its result. */
const FIXTURE_TIMEOUT_MS = 90_000;
/** How long the service gets to log a line it was asked to. */
const LOG_TIMEOUT_MS = 15_000;

/** What around a page it needs: the projects the service starts with, and whether the Fixture Panel and another window are there. */
interface Setup {
    page: string;
    seed: (fixture: OtherPanel | null) => Promise<Seed>;
    fixturePanel: boolean;
    window: boolean;
}

/** The flow that logs, one line per Run: When Run is clicked, Log the Fixture Panel's Next Line. */
async function sayingFlow(fixture: OtherPanel): Promise<SavedFlows> {
    const entries = await fixture.ask<{ panelId: string; entry: string; schema: any }[]>({ do: "list" });
    const nextLine = entries.find((e) => e.panelId === FIXTURE_PANEL && e.entry === "value.next-line");
    if (!nextLine) throw new Error(`the Fixture Panel offers no Next Line: ${JSON.stringify(entries)}`);
    const type = registryBlockType({ kind: "value", panelId: FIXTURE_PANEL, entry: nextLine.entry });
    return {
        workspace: {
            blocks: {
                languageVersion: 0,
                blocks: [{ type: BUILTIN.onRun, id: "say", x: 40, y: 40, inputs: { DO: { block: { type: BUILTIN.log, id: "say-log", inputs: { TEXT: { block: { type, id: "say-line" } } } } } } }],
            },
        },
        schemas: { [type]: nextLine },
    } as SavedFlows;
}

/** Each fixture's page, relative to the panel, and what it runs over. */
const PAGES = {
    /** the editor, with blocks dragged about in it (test/fixtures/editorFixture.tsx) */
    editor: { page: "test/fixtures/editorFixture.html", seed: async () => ({ projects: [SERVICED] }), fixturePanel: true, window: false },
    /** the whole panel, while the service and other windows change things (test/fixtures/panelFixture.tsx) */
    panel: {
        page: "test/fixtures/panelFixture.html",
        seed: async (fixture) => ({ projects: [SERVICED], flows: { [SERVICED_PROJECT]: await sayingFlow(fixture!) } }),
        fixturePanel: true,
        window: true,
    },
    /** the whole panel, from no projects at all (test/fixtures/projectsFixture.tsx) */
    projects: { page: "test/fixtures/projectsFixture.html", seed: async () => ({ projects: [] }), fixturePanel: false, window: false },
    /** the whole panel, over projects the service couldn't read as it started (test/fixtures/unreadableFixture.tsx) */
    unreadable: { page: "test/fixtures/unreadableFixture.html", seed: async () => ({ projects: [], unreadable: true }), fixturePanel: false, window: false },
    /** the editor's Load backup window, over backups kept on this computer (test/fixtures/backupsFixture.tsx) */
    backups: { page: "test/fixtures/backupsFixture.html", seed: async () => ({ projects: [SERVICED], backupsHere: true }), fixturePanel: false, window: false },
} satisfies Record<string, Setup>;
export type FixtureName = keyof typeof PAGES;

export interface FixtureResults {
    checks: Record<string, any>;
    error: string;
}

// The page's hold on its socket, before its own scripts. A call of the
// panel's contract travels as an internal block ("command.call-save-flows",
// its input in request.inputs.input); a listing as "blocks:list"; an answer
// comes back as a "response" frame with the call's id.
const WIRE = `(() => {
    const calls = [];
    const refused = new Set();
    const refusedActions = new Set();
    let holding = 0;
    const heldIds = new Set();
    const heldAnswers = [];
    const camel = (kebab) => kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        const frame = typeof data === "string" && data.startsWith("{") ? JSON.parse(data) : null;
        const entry = frame?.action === "blocks:call" && frame.params?.panelId === ${JSON.stringify(PANEL_ID)} ? String(frame.params.entry) : "";
        if (entry.startsWith("command.call-")) {
            const name = camel(entry.slice("command.call-".length));
            const input = frame.params.request?.inputs?.input ?? {};
            calls.push({ name, input: structuredClone(input) });
            if (refused.has(name)) {
                frame.params.request.inputs.input = { ...input, project: ${JSON.stringify(REFUSED_PROJECT)} };
                data = JSON.stringify(frame);
            }
        }
        if (frame && refusedActions.has(frame.action) && frame.params?.panelId === ${JSON.stringify(PANEL_ID)}) {
            frame.params.panelId = ${JSON.stringify(ABSENT_PANEL)};
            data = JSON.stringify(frame);
        }
        if (frame?.action === "blocks:list" && holding > 0) {
            holding--;
            heldIds.add(frame.id);
        }
        return send.call(this, data);
    };
    const listen = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function (type, listener, options) {
        if (type !== "message") return listen.call(this, type, listener, options);
        return listen.call(this, type, (event) => {
            const frame = heldIds.size && typeof event.data === "string" && event.data.startsWith("{") ? JSON.parse(event.data) : null;
            if (frame?.type === "response" && heldIds.delete(frame.id)) return void heldAnswers.push(() => listener(event));
            listener(event);
        }, options);
    };
    window.__wire = {
        calls,
        refuse: (name, on) => (on ? refused.add(name) : refused.delete(name)),
        refuseAction: (action, on) => (on ? refusedActions.add(action) : refusedActions.delete(action)),
        holdNextList: () => void holding++,
        held: () => heldAnswers.length,
        release: () => { for (const deliver of heldAnswers.splice(0)) deliver(); },
    };
})();`;

// The shell, as a page meets it: it frames the page, challenges it, keeps
// what the page says of its unsaved work, and asks it whether it may go.
const SHELL = (src: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="panel" src="${src}"></iframe><script>
const frame = document.getElementById("panel");
const GENERATION = "fixture";
const leaving = new Map();
let asked = 0;
window.__unsaved = false;
addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== frame.contentWindow || data?.generation !== GENERATION) return;
    if (data.type === "paperboard:unsaved-changes") window.__unsaved = data.unsaved === true;
    if (data.type === "paperboard:leave-answer") {
        const answered = leaving.get(data.requestId);
        leaving.delete(data.requestId);
        answered?.(data);
    }
});
frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "paperboard:initialize", generation: GENERATION, mobile: false }, "*"));
window.__askLeave = () => new Promise((resolve, reject) => {
    const requestId = "leave-" + ++asked;
    leaving.set(requestId, (answer) => (answer.error ? reject(new Error(answer.error)) : resolve(answer.leave)));
    frame.contentWindow.postMessage({ type: "paperboard:leave-request", generation: GENERATION, requestId }, "*");
});
</script></body></html>`;

async function build(outDir: string): Promise<void> {
    const { build } = await import("vite");
    const solidPlugin = (await import("vite-plugin-solid")).default;
    await build({
        root: panelDir,
        configFile: false,
        logLevel: "error",
        plugins: [solidPlugin()],
        resolve: { dedupe: ["solid-js", "solid-js/web", "solid-js/store"] },
        build: { outDir, emptyOutDir: true, minify: false, rollupOptions: { input: Object.values(PAGES).map((p) => join(panelDir, p.page)) } },
    });
}

/** What the page can ask the test for (fixtures/wire.ts ask), over the service and panels started for it. */
function asking(daemon: TestDaemon, service: BlocksService, others: { fixture: OtherPanel | null; window: OtherPanel | null; late: OtherPanel | null }) {
    const other = (panel: OtherPanel | null, name: string) => {
        if (!panel) throw new Error(`this page runs without the ${name}`);
        return panel;
    };
    /** the service logs `line`: the Fixture Panel's next line is it, and Run starts the flow that logs it */
    async function say(line: string): Promise<void> {
        const window = other(others.window, "window");
        const logged = (state: { log: { message: string }[] }) => state.log.filter((e) => e.message === line).length;
        const before = logged(await window.ask({ do: "state" }));
        await other(others.fixture, "Fixture Panel").ask({ do: "lines", lines: [line] });
        await window.ask({ do: "call", name: "runFlows", input: { project: SERVICED_PROJECT } });
        const deadline = Date.now() + LOG_TIMEOUT_MS;
        // the state is read again every few milliseconds, up to the deadline
        while (logged(await window.ask({ do: "state" })) === before) {
            if (Date.now() > deadline) throw new Error(`the service didn't log "${line}":\n${service.output()}`);
            // quiet: the poll interval of a deadline-bound wait for the log line
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
    return async (to: string, request: Record<string, any>): Promise<unknown> => {
        if (to === "window") return other(others.window, "window").ask(request);
        if (to === "fixture") return other(others.fixture, "Fixture Panel").ask(request);
        if (to === "say") {
            for (const line of request.lines as string[]) await say(line);
            return null;
        }
        if (to === "late" && request.do === "start") {
            others.late ??= await startOtherPanel(daemon, LATE_PANEL, LATE_PANEL_NAME, "late");
            return null;
        }
        if (to === "projects" && request.do === "mend") {
            // the project list is readable again, and holds no projects
            writeFileSync(join(service.storage, PROJECTS_FILE), JSON.stringify({ version: PROJECTS_VERSION, projects: [] }));
            return null;
        }
        if (to === "registry") {
            service.refuse(request.away ? { match: (f) => f.action === "blocks:emit" && String(f.params?.entry).startsWith("value."), error: REGISTRY_AWAY } : null);
            return null;
        }
        throw new Error(`the test can't ${to} ${JSON.stringify(request)}`);
    };
}

/** Starts what the page runs over, serves the build to it, and waits for what it reports. */
async function runPage(chrome: Chrome, dist: string, setup: Setup): Promise<FixtureResults> {
    let daemon: TestDaemon | null = null;
    const others: { fixture: OtherPanel | null; window: OtherPanel | null; late: OtherPanel | null } = { fixture: null, window: null, late: null };
    let service: BlocksService | null = null;
    let server: ReturnType<typeof Bun.serve> | undefined;
    let tab: Page | undefined;
    // the page's scripts run before its tab is handed back: what it asks of the tab waits for it
    let tabOpened!: (page: Page) => void;
    const tabReady = new Promise<Page>((resolve) => (tabOpened = resolve));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        daemon = await startDaemon();
        if (setup.fixturePanel) others.fixture = await startOtherPanel(daemon, FIXTURE_PANEL, FIXTURE_PANEL_NAME, "fixture");
        service = await startBlocksService(daemon, await setup.seed(others.fixture));
        if (setup.window) others.window = await startOtherPanel(daemon, PANEL_ID, "Blocks", "window");
        const ask = asking(daemon, service, others);
        const creds = JSON.stringify({ port: daemon.port, token: await daemon.token(PANEL_ID), scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
        let report!: (results: FixtureResults) => void;
        const reported = new Promise<FixtureResults>((done) => (report = done));
        server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
                const url = new URL(request.url);
                if (url.pathname === "/") return new Response(SHELL(`/${setup.page}`), { headers: { "content-type": "text/html; charset=utf-8" } });
                if (request.method === "POST" && url.pathname === "/result") {
                    report((await request.json()) as FixtureResults);
                    return new Response("ok");
                }
                if (request.method === "POST" && url.pathname === "/ask") {
                    const { to, request: asked } = (await request.json()) as { to: string; request: Record<string, unknown> };
                    try {
                        return Response.json({ result: (await ask(to, asked)) ?? null });
                    } catch (err) {
                        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
                    }
                }
                if (request.method === "POST" && url.pathname === "/input") {
                    const { calls } = (await request.json()) as { calls: { method: string; params: Record<string, unknown> }[] };
                    const tab = await tabReady;
                    for (const call of calls) {
                        if (!call.method.startsWith("Input.")) throw new Error(`a fixture sends only Input calls, not ${call.method}`);
                        await tab.send(call.method, call.params);
                    }
                    return new Response("ok");
                }
                if (request.method === "POST" && url.pathname === "/viewport") {
                    // the window resized to a size, or back to its own with none
                    const size = (await request.json()) as { width: number; height: number } | null;
                    const tab = await tabReady;
                    if (size) await tab.resize(size.width, size.height);
                    else await tab.send("Emulation.clearDeviceMetricsOverride");
                    return new Response("ok");
                }
                if (request.method === "POST" && url.pathname === "/screenshot") {
                    const { name, width, height } = (await request.json()) as { name: string; width: number; height: number };
                    const tab = await tabReady;
                    if (!shots) return new Response("ok");
                    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" is not a screenshot name`);
                    await tab.resize(width, height);
                    writeFileSync(join(shots, `${name}.png`), await tab.screenshot());
                    await tab.send("Emulation.clearDeviceMetricsOverride");
                    return new Response("ok");
                }
                const file = join(dist, url.pathname);
                if (!file.startsWith(dist + "/") || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
                if (file.endsWith(".html")) {
                    const html = readFileSync(file, "utf8").replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};${WIRE}</script>`);
                    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
                }
                return new Response(Bun.file(file));
            },
            error: (err) => new Response(String(err), { status: 500 }),
        });
        tab = await chrome.open(`http://127.0.0.1:${server.port}/`);
        tabOpened(tab);
        const opened = tab;
        const outcome = await Promise.race([
            reported,
            new Promise<string>((late) => (timer = setTimeout(() => late(`the fixture did not report within ${FIXTURE_TIMEOUT_MS / 1000}s`), FIXTURE_TIMEOUT_MS))),
        ]);
        if (typeof outcome === "string") throw new Error(`${outcome}; the page threw: ${JSON.stringify(opened.exceptions)}\nthe service said:\n${service.output()}`);
        return outcome;
    } finally {
        clearTimeout(timer);
        await tab?.close();
        server?.stop(true);
        for (const panel of [others.late, others.window, others.fixture]) await panel?.stop();
        await service?.stop();
        await daemon?.stop();
    }
}

/** Builds the pages, opens them all at once, and closes Chrome once every one has reported. */
function runAll(): Record<FixtureName, Promise<FixtureResults>> {
    // in the test process's throwaway data folder, which goes with the process (test/hermetic.ts)
    const dir = mkdtempSync(join(process.env.PAPERBOARD_DIR!, "fixture-"));
    const dist = join(dir, "dist");
    const ready = Promise.all([build(dist), launchChrome({ onPort: (port) => allowedPorts.add(port) })]);
    const runs = Object.fromEntries(Object.entries(PAGES).map(([name, setup]) => [name, ready.then(([, chrome]) => runPage(chrome, dist, setup))])) as Record<FixtureName, Promise<FixtureResults>>;
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
