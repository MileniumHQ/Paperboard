// The agent's computer: a headless Helium the service owns, its tabs the
// agent's windows.
//
// The browser is a daemon-supervised child (processApi), so its lifetime is
// observed through the daemon: start waits for its DevTools endpoint and a
// working connection, stop waits for the exit event. What keeps the agent off
// this machine is outside the page: the browser's only way out is the
// service's proxy (proxy.ts), loopback included, and its profile keeps WebRTC
// from sending UDP around it (checked at every start). Pages run in
// Chromium's own sandbox.
//
// The agent acts through the browser's own input (Input.dispatch*), and reads
// pages in an isolated world the page's scripts can't see or change. Its home
// folder (homeFolder.ts) holds what the browser downloads and what it's given.
// This file is the browser's life: setting it up, starting it, its DevTools
// connection and stopping it. Its package, record and profile are
// browserSetup.ts; its windows and their input, browserWindows.ts; its
// downloads, browserDownloads.ts. What the agent does with them is
// browserTools.ts; what the user sees and does, browserView.ts.

import fs from "node:fs";
import path from "node:path";
import { errorMessage, SerialQueue, stopProcess } from "@mileniumhq/paperapi";
import { LIMITS, PANEL_ID, SETUP_STEPS, type ComputerState, type SetupStep, type SetupStepId } from "../contract";
import { Cdp } from "./cdp";
import { chromiumMajor, heliumSupported, userAgent } from "./helium";
import type { HomeFolder } from "./homeFolder";
import { WEBRTC_CANDIDATES_JS } from "./pageScripts";
import { startProxy, type Proxy } from "./proxy";
import { NO_RECORD, RECORD_FILE, executable, fetchHelium, readRecord, seedPreferences, writeRecord, type BrowserRecord, type PackageHost } from "./browserSetup";
import { ToolError, Windows } from "./browserWindows";
import { Downloads } from "./browserDownloads";

export const BROWSER_PROC_ID = `${PANEL_ID}.browser`;

const START_MS = 30_000;
const MAX_CALLS = 4;
const NOTES_MAX = 20;
/** control lasts this long past the last renewal, so a closed shell can't hold the agent off */
const CONTROL_LEASE_MS = 20_000;

/** A daemon-supervised child (processApi.start). */
export interface StartOptions {
    id: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** false: started with its input closed */
    stdin?: boolean;
}

export interface ComputerHost {
    start(o: StartOptions): Promise<unknown>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onExit(id: string, cb: (code?: number) => void): () => void;
    onStderr(id: string, cb: (data: string) => void): () => void;
    /** the daemon's runtime packages (packageApi): it checks and unpacks them, and holds updates while they run */
    packages: PackageHost;
}

export interface BrowserDeps {
    host: ComputerHost;
    /** absolute path of the computer's folder in the panel's storage */
    dir: string;
    /** the agent's home folder: where downloads go and uploads come from. Erasing the computer empties it */
    home: HomeFolder;
    /** the same folder relative to the panel's storage, for downloads */
    storagePath: string;
    onState: (s: ComputerState) => void;
    /** the agent's pages, the one thing on this computer its browser may open */
    pages?: (host: string, port: number) => boolean;
    platform?: NodeJS.Platform;
    arch?: string;
    controlLeaseMs?: number;
    startMs?: number;
}

interface PendingSignIn {
    id: string;
    targetId: string;
    window: number;
    site: string;
    fields: { x: number; y: number }[];
    submit: { x: number; y: number } | null;
}

export class BrowserComputer {
    state: ComputerState = { phase: "none", installed: false, steps: [], error: null, userControl: false };
    readonly home: HomeFolder;
    readonly windows: Windows;
    private downloads: Downloads;
    private record: BrowserRecord = NO_RECORD;
    private busy = new SerialQueue();
    private abort: AbortController | null = null;
    private offs: (() => void)[] = [];
    private stderrTail = "";
    private running = false;
    private stopping = false;
    private cdp: Cdp | null = null;
    private proxy: Proxy | null = null;
    notes: string[] = [];
    /** the sign-in the agent prepared (browserTools.ts), waiting for the user's values (browserView.ts) */
    signIn: PendingSignIn | null = null;
    private calls = 0;
    private callQueue: (() => void)[] = [];
    /** the user's view's calls running now (browserView.ts) */
    viewCalls = 0;
    private control: ReturnType<typeof setTimeout> | null = null;

    constructor(private deps: BrowserDeps) {
        this.home = deps.home;
        const note = (text: string) => this.note(text);
        this.windows = new Windows({ connection: () => this.connection(), note, platform: this.platform });
        this.downloads = new Downloads({ home: deps.home, dir: path.join(deps.dir, "downloading"), note });
    }

    private get platform() {
        return this.deps.platform ?? process.platform;
    }
    private get supported() {
        return heliumSupported(this.platform, this.deps.arch ?? process.arch);
    }
    /** started, and its DevTools connection open */
    get on() {
        return this.state.phase === "ready" && !!this.cdp?.open;
    }

    // ------------------------------------------------------------- lifecycle

    async init(): Promise<void> {
        this.offs.push(
            this.deps.host.onExit(BROWSER_PROC_ID, (code) => this.onExited(code)),
            this.deps.host.onStderr(BROWSER_PROC_ID, (data) => {
                this.stderrTail = (this.stderrTail + data).slice(-2000);
            }),
        );
        try {
            fs.mkdirSync(this.deps.dir, { recursive: true });
            this.record = readRecord(this.deps.dir);
        } catch (e) {
            this.set({ phase: "failed", error: errorMessage(e) });
            return;
        }
        if (!this.supported) {
            this.set({ phase: "unsupported", installed: false, error: `There's no browser for ${this.platform} on ${this.deps.arch ?? process.arch} yet.` });
            return;
        }
        if (!this.record.installed) {
            this.set({ phase: "none", installed: false });
            return;
        }
        this.set({ phase: "stopped", installed: true });
        // a browser the last service generation left running is stopped: its tabs and connection were that generation's
        await this.failing("The browser left running from before couldn't be stopped", async () => {
            if (await this.deps.host.exists(BROWSER_PROC_ID)) {
                this.running = true;
                await this.kill();
            }
        });
        await this.start();
    }

    /** Set it up from nothing: download and unpack the browser, then start it. Whatever was on it before is erased. */
    install(): Promise<void> {
        return this.busy.run(() => this.doInstall(true));
    }

    start(): Promise<void> {
        return this.busy.run(() => this.doStart());
    }

    stop(): Promise<void> {
        return this.busy.run(async () => {
            this.set({ phase: "stopping" });
            await this.failing("The browser couldn't be stopped", () => this.kill());
            this.set({ phase: this.record.installed ? "stopped" : "none" });
        });
    }

    /** The service is going away: stop the browser and observe it gone, quickly. */
    async shutdown(): Promise<void> {
        this.abort?.abort();
        await this.kill();
        for (const off of this.offs.splice(0)) off();
    }

    /** Run a step whose failure is the computer's: its state says why, and the caller still gets the failure. */
    private async failing<T>(what: string, fn: () => Promise<T>): Promise<T> {
        try {
            return await fn();
        } catch (e) {
            this.set({ phase: "failed", error: `${what}: ${errorMessage(e)}` });
            throw e;
        }
    }

    private set(patch: Partial<ComputerState>) {
        this.state = { ...this.state, ...patch, userControl: this.control !== null };
        this.deps.onState(this.state);
    }

    private async doInstall(erase: boolean) {
        if (!this.supported) throw new Error("no browser for this computer");
        await this.failing("The computer couldn't be set up", async () => {
            await this.kill();
            if (!erase) return;
            // the browser is observed stopped first: nothing is writing its profile or home folder now
            this.record = { ...this.record, installed: false };
            writeRecord(this.deps.dir, this.record);
            for (const name of fs.readdirSync(this.deps.dir)) {
                if (name !== RECORD_FILE) fs.rmSync(path.join(this.deps.dir, name), { recursive: true, force: true });
            }
            // the computer's files are its home folder's: erasing it erases them too
            this.home.erase();
        });
        const abort = (this.abort = new AbortController());
        const steps: SetupStep[] = SETUP_STEPS.map((id) => ({ id, status: "waiting", percent: null, bytes: null }));
        const step = (id: SetupStepId, patch: Partial<SetupStep>) => {
            const s = steps.find((x) => x.id === id)!;
            Object.assign(s, patch);
            this.set({ steps: steps.map((x) => ({ ...x })) });
        };
        this.set({ phase: "installing", error: null, steps: steps.map((x) => ({ ...x })) });
        // the step a failure belongs to; starting the browser takes a moment and has no step, its failure is the error alone
        let current: SetupStepId | null = "download";
        try {
            await fetchHelium(this.deps.host.packages, this.deps.dir, abort.signal, (id, patch) => {
                current = id;
                step(id, patch);
            });
            current = null;
            this.record = { ...this.record, installed: true };
            writeRecord(this.deps.dir, this.record);
            await this.launch(abort.signal);
            // the finished steps stay, each done: the setup ends on its loaders, not on a blank
            this.set({ phase: "ready", installed: true });
        } catch (e) {
            if (current) step(current, { status: "failed" });
            await this.failed(e, { installed: this.record.installed });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    private async doStart() {
        if (this.on) return;
        const abort = (this.abort = new AbortController());
        try {
            if (!this.record.installed) throw new Error("Set up the computer first.");
            if (!(await executable(this.deps.host.packages))) {
                // no browser package yet (set up before it was one): fetched like a setup, the profile and home folder kept
                await this.doInstall(false);
                return;
            }
            this.set({ phase: "starting", error: null, steps: [] });
            await this.launch(abort.signal);
            this.set({ phase: "ready" });
        } catch (e) {
            await this.failed(e);
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    /** A start or a setup that failed: the browser is stopped, and the state says why, with a stop that failed too. */
    private async failed(e: unknown, patch: Partial<ComputerState> = {}) {
        const unstopped = await this.kill().then(() => null, errorMessage);
        this.set({ ...patch, phase: "failed", error: unstopped === null ? errorMessage(e) : `${errorMessage(e)}. The browser couldn't be stopped either: ${unstopped}` });
    }

    private profileDir() {
        return path.join(this.deps.dir, "profile");
    }
    /** The browser's own home as macOS sees it (not the agent's home folder): the Library it writes, like its crash database, stays in here. */
    private systemHomeDir() {
        return path.join(this.deps.dir, "system");
    }

    private async launch(signal: AbortSignal): Promise<void> {
        const exe = await executable(this.deps.host.packages);
        if (!exe) throw new Error("The browser isn't installed; set the computer up again.");
        this.home.ensure();
        this.downloads.prepare();
        seedPreferences(this.profileDir());
        const portFile = path.join(this.profileDir(), "DevToolsActivePort");
        fs.rmSync(portFile, { force: true });
        this.stderrTail = "";
        this.proxy = await startProxy({ local: this.deps.pages });
        const args = [
            "--headless",
            `--user-data-dir=${this.profileDir()}`,
            "--remote-debugging-port=0",
            `--proxy-server=http://127.0.0.1:${this.proxy.port}`,
            // without this, Chromium never sends loopback to a proxy: it would reach this machine directly
            "--proxy-bypass-list=<-loopback>",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            // the version the browser last reported; a first start goes without, and asks
            ...(this.record.chromium === null ? [] : [`--user-agent=${userAgent(this.record.chromium, this.platform, this.deps.arch ?? process.arch)}`]),
            "--window-size=1280,800",
            "--hide-crash-restore-bubble",
            "--disable-features=Translate,MediaRouter",
            // no OS keyring prompt (Linux) or keychain prompt (macOS) from a browser nobody can see
            "--password-store=basic",
            "--use-mock-keychain",
            "about:blank",
        ];
        // running from before it's asked for: an exit that comes while starting is still seen
        this.running = true;
        try {
            // macOS: Helium keeps its crash database under the user's Library, not the profile; a home of its own keeps it here
            const env = this.platform === "darwin" ? { CFFIXED_USER_HOME: this.systemHomeDir() } : undefined;
            if (env) fs.mkdirSync(env.CFFIXED_USER_HOME, { recursive: true });
            await this.deps.host.start({ id: BROWSER_PROC_ID, command: exe, args, cwd: this.deps.dir, env });
        } catch (e) {
            this.running = await this.deps.host.exists(BROWSER_PROC_ID);
            throw e;
        }
        const deadline = Date.now() + (this.deps.startMs ?? START_MS);
        let line = "";
        while (!line) {
            if (signal.aborted) throw new Error("starting was stopped");
            if (!this.running) throw new Error(this.exitReason());
            if (Date.now() > deadline) throw new Error("The browser didn't open its DevTools endpoint in time.");
            await new Promise((r) => setTimeout(r, 100));
            line = fs.existsSync(portFile) ? fs.readFileSync(portFile, "utf8") : "";
        }
        const [port, wsPath] = line.trim().split("\n");
        if (!/^\d+$/.test(port ?? "") || !wsPath?.startsWith("/devtools/browser/")) throw new Error("The browser's DevTools endpoint was unreadable.");
        const cdp = (this.cdp = await Cdp.connect(`ws://127.0.0.1:${port}${wsPath}`));
        cdp.onClose((why) => void this.onConnectionLost(cdp, why));
        // Helium updates on its own: a user agent naming another Chromium than the one running is a tell
        const major = chromiumMajor((await cdp.send<{ product?: string }>("Browser.getVersion")).product);
        if (major !== this.record.chromium) {
            this.record = { ...this.record, chromium: major };
            writeRecord(this.deps.dir, this.record);
            await this.kill();
            return this.launch(signal);
        }
        this.windows.listen(cdp);
        this.downloads.listen(cdp);
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: this.downloads.dir, eventsEnabled: true });
        const { targetInfos } = await cdp.send<{ targetInfos: any[] }>("Target.getTargets");
        for (const t of targetInfos) this.windows.track(t);
        await this.checkWebRtc();
    }

    /** The profile's WebRTC policy is what keeps UDP on the proxy's side: observed at every start, not assumed. */
    private async checkWebRtc() {
        const blank = [...this.windows.tabs.values()][0];
        if (!blank) throw new Error("The browser opened no page to check itself in.");
        const n = await this.windows.evaluate(blank, WEBRTC_CANDIDATES_JS, 10_000);
        if (n !== 0) throw new Error(`The browser could send WebRTC traffic around its proxy (${n} routes), so it was stopped.`);
        await this.windows.closeWindow(blank);
        // the check's page was nobody's window: the agent's first is window 1
        this.windows.restartNumbering();
    }

    private exitReason() {
        const tail = this.stderrTail.trim();
        if (/No usable sandbox|setuid sandbox|Failed to move to new namespace/i.test(tail)) {
            return "This system won't let the browser use its sandbox (Ubuntu 24.04 and later restrict it), and it doesn't run without one.";
        }
        return `The browser stopped${tail ? `: ${tail.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400)}` : "."}`;
    }

    private onExited(code?: number) {
        this.running = false;
        const unexpected = !this.stopping && this.state.phase === "ready";
        this.teardown();
        if (unexpected) this.set({ phase: "failed", error: this.exitReason() });
    }

    private async onConnectionLost(cdp: Cdp, why: string) {
        if (this.cdp !== cdp || this.stopping) return;
        if (this.state.phase !== "ready") return; // starting fails on its own
        await this.busy.run(async () => {
            if (this.cdp !== cdp) return;
            let stuck = "";
            try {
                await this.kill();
            } catch (e) {
                stuck = `. It couldn't be stopped either: ${errorMessage(e)}`;
            }
            this.set({ phase: "failed", error: `Lost the browser: ${why}${stuck}` });
        });
    }

    private teardown() {
        const cdp = this.cdp;
        this.cdp = null;
        cdp?.close();
        const proxy = this.proxy;
        this.proxy = null;
        void proxy?.close();
        this.windows.clear();
        this.downloads.clear();
        this.signIn = null;
        // the user's hold on a browser that's gone ends with it
        this.releaseControl();
    }

    /** Stop the browser and observe its exit: SIGTERM, then SIGKILL past the grace. */
    private async kill() {
        this.stopping = true;
        try {
            await stopProcess(BROWSER_PROC_ID, { host: this.deps.host });
            // its exit was seen already, unless it was gone before it was asked to stop
            if (this.running) this.onExited();
        } finally {
            this.teardown();
            this.stopping = false;
        }
    }

    connection(): Cdp {
        if (!this.cdp?.open) throw new ToolError("Your browser isn't running.");
        return this.cdp;
    }

    private note(text: string) {
        this.notes.push(text);
        if (this.notes.length > NOTES_MAX) this.notes.shift();
    }

    // ------------------------------------------------------------- the agent's calls, for browserTools.ts

    /** one of the agent's few calls at once; the rest wait their turn */
    async slot() {
        if (this.calls < MAX_CALLS) {
            this.calls++;
            return;
        }
        await new Promise<void>((ok) => this.callQueue.push(ok));
    }

    release() {
        const next = this.callQueue.shift();
        if (next) next();
        else this.calls--;
    }

    // ------------------------------------------------------------- windows

    /** What's open as a turn starts, for the agent's instructions: windows it left open are its to close. */
    async openWindowsNote(): Promise<string> {
        if (!this.on) return `Your browser isn't running (${this.state.phase}).`;
        await this.windows.refreshAll();
        const list = [...this.windows.tabs.values()].sort((a, b) => a.id - b.id);
        if (!list.length) return "No browser windows are open.";
        return `Browser windows open now (close the ones you're done with):\n${list.map((t) => `- ${t.id}: ${t.title || "(untitled)"} <${t.url}>`).join("\n")}`;
    }

    /** A JPEG of a page, taken in a window opened for it and closed again: an app's picture on its card. */
    async picture(url: string): Promise<string> {
        if (!this.on) throw new Error("your computer is off, and a page's picture is taken in its browser");
        return this.windows.inWindow(url, async (s) => {
            const { data } = await this.connection().send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 }, s, 10_000);
            return data;
        });
    }

    /** A page printed to a PDF, as its own print CSS lays it out: in a window of its own, closed after. */
    async pdf(url: string): Promise<Buffer> {
        if (!this.on) throw new Error("the agent's computer is off, and a page is saved as a PDF in its browser. Start it in the agent's Computer page");
        return this.windows.inWindow(url, async (s) => {
            // its fonts first: a PDF made before they've loaded is set in the fallback
            await this.connection().send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true }, s, 10_000);
            const { data } = await this.connection().send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }, s, 30_000);
            return Buffer.from(data, "base64");
        });
    }

    // ------------------------------------------------------------- files

    /** A file from the computer's home folder. */
    async getFile(file: string): Promise<{ path: string; data: Buffer }> {
        return this.home.read(file);
    }

    /** Write a file in the computer's home folder; returns where it went. */
    async putFile(file: string, data: Buffer): Promise<string> {
        if (data.length > LIMITS.attachments.fileBytes) throw new Error("that file is too big");
        return this.home.write(file, data);
    }

    // ------------------------------------------------------------- the user's control

    /** Take control, or renew it: the agent's hands wait until it's released or the lease runs out. */
    takeControl() {
        if (this.state.phase !== "ready") throw new Error("The computer isn't on.");
        if (this.control) clearTimeout(this.control);
        this.control = setTimeout(() => this.releaseControl(), this.deps.controlLeaseMs ?? CONTROL_LEASE_MS);
        this.set({});
    }

    releaseControl() {
        if (!this.control) return;
        clearTimeout(this.control);
        this.control = null;
        this.set({});
    }
}
