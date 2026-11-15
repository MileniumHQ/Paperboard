// The Agent panel as a person uses it: its real page, built with the panel's
// own vite config, in headless Chrome (scripts/testing/chrome.ts), talking
// to its real service (src/service.ts, in a process of its own) through a
// real daemon in this test process, on the throwaway PAPERBOARD_DIR
// test/hermetic.ts made. The service's PATH and HOME hold only what the test
// puts there (test/support/fakeBrain.mjs as each brain), so no real Codex or
// Claude on the machine is ever used, and nothing reaches the network.
//
// One daemon and one built page per test process, ended when the suite
// ends; a file boots the service once for the tests that share a setup and
// opens a page for the tests that use it (bootPanel).
//
// The daemon is loaded by a path the typechecker does not follow: it is
// another target's source, typechecked by its own gate step.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSupervisor } from "../../../../scripts/supervisor";
import { openChrome, type Page } from "../../../../scripts/testing/chrome";
import { PANEL_ID, type ChatEntry, type Harness, type Settings } from "../../src/contract";
import { History } from "../../src/service/history";
import { TRANSCRIPT, Transcript } from "../../src/service/transcript";
import { allowTestPort, atSuiteEnd } from "../hermetic";
import { FAKE_BRAIN, fakeEnv, plan } from "./host";

export type { Page };
export { PANEL_ID };

const PANEL = path.resolve(import.meta.dir, "../..");
const DAEMON_ENTRY = path.resolve(PANEL, "../../apps/paperboard/papercrane/index.ts");
const SUPERVISOR_ENTRY = path.resolve(PANEL, "../../apps/paperboard/papercrane/supervisorBinary.ts");
const SERVICE_ENTRY = path.join(PANEL, "src/service.ts");
const WAIT_MS = 20_000;

interface ServerInstance {
    localPort: number;
    server: { once(event: "close", cb: () => void): void };
    auth: { issuePanelToken(panelId: string): string };
    stop(): void;
}

function within<T>(what: string, promise: Promise<T>, context?: () => string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${WAIT_MS} ms waiting for ${what}${context ? `\n${context()}` : ""}`)), WAIT_MS);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let daemon: Promise<{ instance: ServerInstance; dataDir: string }> | null = null;
function testDaemon() {
    daemon ??= (async () => {
        const dataDir = process.env.PAPERBOARD_DIR;
        if (!dataDir || !dataDir.startsWith(os.tmpdir())) throw new Error(`PAPERBOARD_DIR must be the throwaway dir test/hermetic.ts made, not ${dataDir}`);
        const entry: string = DAEMON_ENTRY;
        const mod = (await import(entry)) as { startPaperCraneServer(options: Record<string, unknown>): Promise<ServerInstance> };
        // the service runs the brain's commands through the daemon, under the workload supervisor, as in a release
        const supervisorEntry: string = SUPERVISOR_ENTRY;
        const supervisor = (await import(supervisorEntry)) as { setSupervisorBinary(read: () => Uint8Array): void };
        const binary = buildSupervisor();
        supervisor.setSupervisorBinary(() => fs.readFileSync(binary));
        const instance = await mod.startPaperCraneServer({ host: "127.0.0.1", port: 0, headless: true, advertise: false });
        atSuiteEnd(async () => {
            const closed = new Promise<void>((resolve) => instance.server.once("close", () => resolve()));
            instance.stop();
            await within("the test daemon to close", closed);
            if (built) fs.rmSync(built, { recursive: true, force: true });
        });
        return { instance, dataDir };
    })();
    return daemon;
}

let built: string | null = null;
/** the panel's page as `bun run build` makes it, built once per test process */
function panelUi(): string {
    if (built) return built;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "pb-agents-ui-"));
    const build = spawnSync(process.execPath, ["x", "vite", "build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: PANEL, encoding: "utf8" });
    if (build.status !== 0 || !fs.existsSync(path.join(out, "index.html"))) {
        throw new Error(`Building the panel's page failed (exit ${build.status}):\n${build.stdout}\n${build.stderr}`);
    }
    built = out;
    return out;
}

export interface BootedPanel {
    /** the panel's own folder in the daemon's data directory (its storage) */
    storage: string;
    /** the fake brains' folder: their log and plan (test/support/host.ts fakeLog, plan, release) */
    fake: string;
    /**
     * opens the page in a fresh headless Chrome; `init` runs in it before the page's own code (test/support/wire.ts).
     * With `shell`, the page is a frame (#panel) of a page standing in for Paperboard's shell (SHELL_PAGE), which runs `shell`.
     */
    open(o?: { init?: string; shell?: string }): Promise<Page>;
    /** the settings the service has saved, as the next window would read them */
    savedSettings(): Settings | null;
    /** resolves once the saved settings are `expected`; fails saying what they were */
    settingsSaved(expected: Settings): Promise<void>;
    /** everything the service printed */
    output(): string;
    /** the page's pages closed, the service stopped and the panel's data removed */
    close(): Promise<void>;
}

/** a brain on the computer: the fake brain on PATH as its program, signed in or not, `chosen` or only found, told `plan` */
export interface FakeBrain {
    signedIn: boolean;
    chosen?: boolean;
    plan?: Record<string, unknown>;
}

/** each harness's program, as the fake brain acts it, and the file in its storage that says it's signed in */
const PROGRAMS: Record<Harness, { program: string; signedIn: string }> = {
    codex: { program: "codex", signedIn: "auth.json" },
    "claude-code": { program: "claude", signedIn: "signed-in" },
    opencode: { program: "opencode", signedIn: "auth.json" },
};

export interface BootOptions {
    settings?: Settings;
    /** files to put in the panel's storage before the service starts, by path relative to it */
    storage?: Record<string, unknown>;
    /** the tool servers' document (tools.json) */
    tools?: unknown;
    /**
     * Codex is on the computer: test/support/fakeBrain.mjs on PATH as `codex`, signed in or not, and
     * `chosen` as the brain or only found; `plan` is what the fake is told to do (see fakeBrain.mjs)
     */
    codexOnPath?: FakeBrain;
    /** more brains on the computer, the same way: the fake brain on PATH as each harness's program */
    brainsOnPath?: Partial<Record<Harness, FakeBrain>>;
    /** writes more of the panel's storage before the service starts, with the service's own code */
    seed?: (storage: string) => Promise<void>;
}

const SHELL_PATH = "/shell.html";
/**
 * Paperboard's side of the panel's frame, as the shell does it: the page in a frame (#panel) the size of the
 * window, told its generation (paperboard:initialize) once it loads, then `script`, which answers what the frame
 * asks its shell. A wait in this page wakes on this page's changes, so every change in the frame is one here
 * too: read the frame through PANEL_DOC.
 */
const shellPage = (script: string) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<iframe id="panel" src="/" style="border:0;width:100vw;height:100vh"></iframe>
<script>
const frame = document.getElementById("panel");
let changes = 0;
frame.addEventListener("load", () => {
    new MutationObserver(() => (document.body.dataset.changes = String(++changes))).observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, characterData: true });
    frame.contentWindow.postMessage({ type: "paperboard:initialize", generation: "g1" }, "*");
});
${script}
</script></body></html>`;
/** a page expression, in a page opened with a shell: the panel's own document, in its frame */
export const PANEL_DOC = `document.getElementById("panel").contentDocument`;

/** Starts the service on the test daemon, with `settings` saved, and serves its page. */
export async function bootPanel(o: BootOptions = {}): Promise<BootedPanel> {
    const { instance, dataDir } = await testDaemon();
    const configs = path.join(dataDir, "configs");
    const storage = path.join(dataDir, "files", PANEL_ID);
    fs.rmSync(storage, { recursive: true, force: true });
    fs.mkdirSync(configs, { recursive: true });
    fs.mkdirSync(storage, { recursive: true });
    const settingsFile = path.join(configs, `${PANEL_ID}.json`);
    fs.rmSync(settingsFile, { force: true });
    if (o.settings) fs.writeFileSync(settingsFile, JSON.stringify(o.settings));
    // a config with a path (tools.json) lives in the panel's files, beside its storage
    for (const [rel, content] of Object.entries({ ...o.storage, ...(o.tools ? { "tools.json": o.tools } : {}) })) {
        const file = path.join(storage, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
    }

    // no brain on this machine is the one under test: on PATH there is only what the test puts there
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "pb-agents-bin-"));
    // the fake brains share a folder: where they log their runs (calls.jsonl) and read their plan
    const fake = path.join(bin, "fake");
    fs.mkdirSync(fake);
    const brains = { ...(o.codexOnPath ? { codex: o.codexOnPath } : {}), ...o.brainsOnPath };
    const choices: Record<string, string> = {};
    for (const [harness, brain] of Object.entries(brains) as [Harness, FakeBrain][]) {
        const { program, signedIn } = PROGRAMS[harness];
        // the fake brain acts as the program its file is named for
        fs.copyFileSync(FAKE_BRAIN, path.join(fake, `${program}.mjs`));
        const env = fakeEnv(fake);
        fs.writeFileSync(path.join(bin, program), `#!/bin/sh\nFAKE_DIR='${env.FAKE_DIR}' FAKE_FIXTURES='${env.FAKE_FIXTURES}' exec '${process.execPath}' '${path.join(fake, `${program}.mjs`)}' "$@"\n`, { mode: 0o755 });
        if (brain.plan) plan(fake, brain.plan);
        fs.mkdirSync(path.join(storage, "brains", harness), { recursive: true });
        if (brain.signedIn) fs.writeFileSync(path.join(storage, "brains", harness, signedIn), "{}");
        if (brain.chosen) choices[harness] = path.join(bin, program);
    }
    if (Object.keys(choices).length) fs.writeFileSync(path.join(storage, "brains", "choices.json"), JSON.stringify(choices));
    await o.seed?.(storage);
    const nowhere = "http://127.0.0.1:9";
    const env: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
        HOME: bin,
        PAPERBOARD_DIR: dataDir,
        PAPERBOARD_PANEL_ID: PANEL_ID,
        PAPERCRANE_PANEL_TOKEN: instance.auth.issuePanelToken(PANEL_ID),
        PAPERCRANE_PORT: String(instance.localPort),
        HTTP_PROXY: nowhere,
        HTTPS_PROXY: nowhere,
        ALL_PROXY: nowhere,
        http_proxy: nowhere,
        https_proxy: nowhere,
        all_proxy: nowhere,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
    };
    delete env.PAPERCRANE_TOKEN;
    const child: ChildProcess = spawn(process.execPath, [SERVICE_ENTRY], { env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let log = "";
    child.stdout!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    child.stderr!.on("data", (chunk: Buffer) => (log += chunk.toString("utf8")));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: any) => {
            if (message?.type === "paperboard:service-ready" && message.panelId === PANEL_ID) resolve();
        });
        void exited.then(() => reject(new Error(`The Agent service exited before it was ready:\n${log}`)));
    });
    await within("the Agent service to report ready", ready, () => log);

    const dist = panelUi();
    const creds = JSON.stringify({ port: instance.localPort, token: instance.auth.issuePanelToken(PANEL_ID), scoped: true, computerId: "local", panelId: PANEL_ID }).replace(/</g, "\\u003c");
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const pathname = new URL(req.url).pathname;
            if (pathname === SHELL_PATH && shell !== null) return new Response(shellPage(shell), { headers: { "content-type": "text/html; charset=utf-8" } });
            const file = path.join(dist, pathname === "/" ? "index.html" : pathname);
            if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response("Not found", { status: 404 });
            if (file.endsWith(".html")) {
                const html = fs
                    .readFileSync(file, "utf8")
                    .replace(/<head[^>]*>/i, (m) => `${m}<script>window.__PAPERBOARD_CRANE=${creds};document.documentElement.setAttribute("data-paper-mobile","false");</script>`);
                return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
            }
            return new Response(Bun.file(file));
        },
    });
    // what the shell page standing in for Paperboard's runs, once a page is opened in it
    let shell: string | null = null;
    const savedSettings = () => (fs.existsSync(settingsFile) ? (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Settings) : null);
    const pages = new Set<Page>();
    const disallow: (() => void)[] = [];
    return {
        storage,
        fake,
        output: () => log,
        savedSettings,
        async settingsSaved(expected) {
            const deadline = Date.now() + WAIT_MS;
            // the file is read again every few milliseconds, up to the deadline
            while (!Bun.deepEquals(savedSettings(), expected)) {
                if (Date.now() > deadline) throw new Error(`The saved settings are ${JSON.stringify(savedSettings())}, not ${JSON.stringify(expected)}`);
                // quiet: the poll interval of a deadline-bound wait for the saved file
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        },
        async open(opened = {}) {
            if (opened.shell !== undefined) shell = opened.shell;
            const page = await openChrome(`http://127.0.0.1:${server.port}${opened.shell === undefined ? "/" : SHELL_PATH}`, {
                onPort: (port) => disallow.push(allowTestPort(port)),
                isCall: (frame) => frame.includes('"action":"blocks:call"'),
                init: opened.init,
            });
            pages.add(page);
            return page;
        },
        async close() {
            for (const page of pages) await page.close();
            for (const undo of disallow) undo();
            server.stop(true);
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
            await within("the Agent service to exit", exited, () => log);
            fs.rmSync(bin, { recursive: true, force: true });
            fs.rmSync(storage, { recursive: true, force: true });
        },
    };
}

/** Opens the menu's `section` (its value: "tools", "settings", "routines"…), from the chat or with the menu open. */
export async function openSection(page: Page, name: string, section: string): Promise<void> {
    const item = `input[name="ai-pages"][value="${section}"]`;
    // a menu still closing is not one to choose from
    await settledMotion(page);
    await page.waitFor(`document.querySelector('[aria-label="${name}: computer and settings"]') || document.querySelector('${item}')`, "the chat or its menu");
    if (!(await page.evaluate<boolean>(`Boolean(document.querySelector('${item}'))`))) await page.click(`[aria-label="${name}: computer and settings"]`);
    await page.waitFor(`document.querySelector('${item}')`, "the menu");
    await settledMotion(page);
    await page.click(item);
    await page.waitFor(`document.querySelector('${item}').checked`, `the ${section} page`);
    await settledMotion(page);
}

/** Resolves once what moves on the page has come to rest (a modal sliding in), so a click lands where it aims. */
export function settledMotion(page: Page): Promise<unknown> {
    return page.evaluate(`Promise.allSettled(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished))`);
}

/** Marks the nodes `selector` finds now, to ask later whether they are the same nodes (kept) or new ones (rebuilt). */
export function markNodes(page: Page, selector: string, mark: string): Promise<number> {
    return page.evaluate<number>(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]; all.forEach((el) => (el.dataset.testMark = ${JSON.stringify(mark)})); return all.length; })()`);
}

/** How many of the nodes `selector` finds now carry `mark`, and how many there are. */
export function marked(page: Page, selector: string, mark: string): Promise<{ kept: number; all: number }> {
    return page.evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})]; return { kept: all.filter((el) => el.dataset.testMark === ${JSON.stringify(mark)}).length, all: all.length }; })()`);
}

/**
 * Writes a conversation into the panel's storage with the service's own code (for BootOptions.seed): the
 * current one, or one put away in the history. Returns the id a put-away one has there.
 */
export function seedConversation(storage: string, entries: ChatEntry[], o: { putAway?: boolean } = {}): string | null {
    const dir = path.join(storage, "conversation");
    fs.mkdirSync(dir, { recursive: true });
    const transcript = new Transcript(path.join(dir, TRANSCRIPT));
    transcript.load();
    for (const entry of entries) transcript.put(entry);
    if (!o.putAway) return null;
    const history = new History(dir);
    const id = history.currentId();
    history.putAway(entries);
    return id;
}

/** Resolves once the page has drawn `frames` frames: what an answer set has landed by then. */
export const frames = (page: Page, frames = 2) =>
    page.evaluate(`new Promise((done) => { let left = ${frames}; const next = () => (left-- === 0 ? done() : requestAnimationFrame(next)); next(); })`);
