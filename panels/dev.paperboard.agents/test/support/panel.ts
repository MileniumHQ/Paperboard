// The Agent panel as a person uses it: its real page, built with the panel's
// own vite config, in headless Chrome (packages/testkit/src/chrome.ts), talking
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
import { buildSupervisor } from "../../../../scripts/build/supervisor";
import { openChrome, type Page } from "testkit/chrome";
import { PANEL_ID, type Harness, type Settings } from "../../src/contract";
import { allowTestPort, atSuiteEnd } from "../hermetic";
import { FAKE_BRAIN, fakeEnv, plan } from "./host";

export type { Page };
export { PANEL_ID };

const PANEL = path.resolve(import.meta.dir, "../..");
const DAEMON_ENTRY = path.resolve(PANEL, "../../apps/daemon/src/index.ts");
const SUPERVISOR_ENTRY = path.resolve(PANEL, "../../apps/daemon/src/workloads/supervisorBinary.ts");
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
    /** opens the page in a fresh headless Chrome */
    open(): Promise<Page>;
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
}

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
        async open() {
            const page = await openChrome(`http://127.0.0.1:${server.port}/`, {
                onPort: (port) => disallow.push(allowTestPort(port)),
                isCall: (frame) => frame.includes('"action":"blocks:call"'),
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
    await page.motionSettled();
    await page.waitFor(`document.querySelector('[aria-label="${name}: computer and settings"]') || document.querySelector('${item}')`, "the chat or its menu");
    if (!(await page.evaluate<boolean>(`Boolean(document.querySelector('${item}'))`))) await page.click(`[aria-label="${name}: computer and settings"]`);
    await page.waitFor(`document.querySelector('${item}')`, "the menu");
    await page.motionSettled();
    await page.click(item);
    await page.waitFor(`document.querySelector('${item}').checked`, `the ${section} page`);
    await page.motionSettled();
}
