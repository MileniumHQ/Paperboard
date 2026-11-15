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
// This file is the browser itself: setting it up, running it, its windows and
// the input they take. What the agent does with them is browserTools.ts; what
// the user sees and does, browserView.ts.

import fs from "node:fs";
import path from "node:path";
import { LIMITS, PANEL_ID, SETUP_STEPS, type PageDialog, type ComputerState, type SetupStep, type SetupStepId } from "../contract";
import { Cdp } from "./cdp";
import { HELIUM_PACKAGE, chromiumMajor, findExecutable, heliumSupported, userAgent } from "./helium";
import type { HomeFolder } from "./homeFolder";
import { chord } from "./keys";
import { WEBRTC_CANDIDATES_JS, type Mark } from "./pageScripts";
import { startProxy, type Proxy } from "./proxy";
import { errorText } from "../lib/failure";
import { writeAtomic } from "./writeAtomic";

export const BROWSER_PROC_ID = `${PANEL_ID}.browser`;
const RECORD_FILE = "browser.json";
const RECORD_VERSION = 1;

const START_MS = 30_000;
const STOP_GRACE_MS = 2_000; // the daemon gives the whole service 3 s to stop
const LOAD_MS = 15_000;
const MAX_TABS = 16;
const MAX_CALLS = 4;
const MAX_DOWNLOADS = 8;
const DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
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

export interface PackageHost {
    isInstalled(name: string): Promise<boolean>;
    download(name: string, onProgress?: (p: { stage: string; percent: number; bytesLoaded?: number; bytesTotal?: number }) => void): Promise<unknown>;
    getPath(name: string): Promise<string>;
}

interface BrowserRecord {
    version: typeof RECORD_VERSION;
    installed: boolean;
    /** the Chromium major the browser last reported: its user agent says the same */
    chromium: number | null;
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

/** A tool's refusal, told to the agent as it is. */
/** A refusal the agent reads as the tool's answer. */
export class ToolError extends Error {}

export interface Tab {
    id: number;
    targetId: string;
    sessionId: string | null;
    attaching: Promise<string> | null;
    title: string;
    url: string;
    /** the latest look's marks; clicks by mark use these */
    marks: Mark[] | null;
    size: { width: number; height: number };
    /** a JavaScript dialog waiting for an answer: the page is paused until it gets one */
    dialog: PageDialog | null;
    /** a file picker the page opened, waiting for `upload` */
    chooser: { backendNodeId: number; multiple: boolean } | null;
    world: { frameId: string; contextId: number } | null;
    loads: Set<() => void>;
    /** told when a dialog opens: input that opened one isn't answered until the dialog is */
    dialogWaiters: Set<() => void>;
    pointer: { x: number; y: number; buttons: number; lastDown: { at: number; x: number; y: number; button: number; count: number } | null };
}

interface Download {
    guid: string;
    name: string;
    tab: number | null;
}

interface PendingSignIn {
    id: string;
    targetId: string;
    window: number;
    site: string;
    fields: { x: number; y: number }[];
    submit: { x: number; y: number } | null;
}

const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

export class BrowserComputer {
    state: ComputerState = { phase: "none", installed: false, steps: [], error: null, userControl: false };
    readonly home: HomeFolder;
    private record: BrowserRecord = { version: RECORD_VERSION, installed: false, chromium: null };
    private busy: Promise<unknown> = Promise.resolve();
    private abort: AbortController | null = null;
    private exitWaiters = new Set<(code?: number) => void>();
    private offs: (() => void)[] = [];
    private stderrTail = "";
    private running = false;
    private stopping = false;
    private cdp: Cdp | null = null;
    private proxy: Proxy | null = null;
    tabs = new Map<string, Tab>();
    private byId = new Map<number, string>();
    private nextId = 1;
    private downloads = new Map<string, Download>();
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
        fs.mkdirSync(this.deps.dir, { recursive: true });
        this.offs.push(
            this.deps.host.onExit(BROWSER_PROC_ID, (code) => this.onExited(code)),
            this.deps.host.onStderr(BROWSER_PROC_ID, (data) => {
                this.stderrTail = (this.stderrTail + data).slice(-2000);
            }),
        );
        try {
            this.record = this.readRecord();
        } catch (e) {
            this.set({ phase: "failed", error: errorText(e) });
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
        if (await this.deps.host.exists(BROWSER_PROC_ID)) {
            this.running = true;
            await this.kill();
        }
        await this.start();
    }

    /** Set it up from nothing: download and unpack the browser, then start it. Whatever was on it before is erased. */
    install(): Promise<void> {
        return this.exclusive(() => this.doInstall(true));
    }

    start(): Promise<void> {
        return this.exclusive(() => this.doStart());
    }

    stop(): Promise<void> {
        return this.exclusive(async () => {
            this.set({ phase: "stopping" });
            await this.kill();
            this.set({ phase: this.record.installed ? "stopped" : "none" });
        });
    }

    /** The service is going away: stop the browser and observe it gone, quickly. */
    async shutdown(): Promise<void> {
        this.releaseControl();
        this.abort?.abort();
        await this.kill();
        for (const off of this.offs.splice(0)) off();
    }

    private exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.busy.then(fn, fn);
        // the caller gets the failure; the queue only waits for it to settle
        this.busy = run.catch(() => undefined);
        return run;
    }

    private set(patch: Partial<ComputerState>) {
        this.state = { ...this.state, ...patch, userControl: this.control !== null };
        this.deps.onState(this.state);
    }

    private readRecord(): BrowserRecord {
        const file = path.join(this.deps.dir, RECORD_FILE);
        let raw: string;
        try {
            raw = fs.readFileSync(file, "utf8");
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: RECORD_VERSION, installed: false, chromium: null };
            throw e;
        }
        let r: Partial<BrowserRecord>;
        try {
            r = JSON.parse(raw);
        } catch {
            throw new Error(`The computer's record (${file}) is unreadable; it was left as it is. Set the computer up again to replace it.`);
        }
        return { version: RECORD_VERSION, installed: r.installed === true, chromium: Number.isInteger(r.chromium) ? r.chromium! : null };
    }

    private writeRecord() {
        writeAtomic(path.join(this.deps.dir, RECORD_FILE), JSON.stringify(this.record, null, 2));
    }

    /** the browser's program in the helium package, or null while it isn't installed */
    private async executable(): Promise<string | null> {
        const packages = this.deps.host.packages;
        if (!(await packages.isInstalled(HELIUM_PACKAGE))) return null;
        return findExecutable(path.join(await packages.getPath(HELIUM_PACKAGE), "bin"));
    }

    private async doInstall(erase: boolean) {
        if (!this.supported) throw new Error("no browser for this computer");
        await this.kill();
        if (erase) {
            // the browser is observed stopped first: nothing is writing its profile or home folder now
            this.record = { ...this.record, installed: false };
            this.writeRecord();
            for (const name of fs.readdirSync(this.deps.dir)) {
                if (name !== RECORD_FILE) fs.rmSync(path.join(this.deps.dir, name), { recursive: true, force: true });
            }
            // the computer's files are its home folder's: erasing it erases them too
            this.home.erase();
        }
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
            await this.fetchHelium(abort.signal, (id, patch) => {
                current = id;
                step(id, patch);
            });
            current = null;
            this.record = { ...this.record, installed: true };
            this.writeRecord();
            await this.launch(abort.signal);
            // the finished steps stay, each done: the setup ends on its loaders, not on a blank
            this.set({ phase: "ready", installed: true });
        } catch (e) {
            await this.kill();
            if (current) step(current, { status: "failed" });
            this.set({ phase: "failed", installed: this.record.installed, error: errorText(e) });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    /** The daemon fetches the helium package (or finds it current) and unpacks it by its recipe. */
    private async fetchHelium(signal: AbortSignal, step: (id: SetupStepId, patch: Partial<SetupStep>) => void) {
        step("download", { status: "running", percent: 0 });
        let unpacking = false;
        await this.deps.host.packages.download(HELIUM_PACKAGE, (p) => {
            if (p.stage === "downloading") {
                const bytes = p.bytesLoaded !== undefined && p.bytesTotal ? { done: p.bytesLoaded, total: p.bytesTotal } : null;
                step("download", { percent: Math.round(p.percent), bytes });
            }
            else if (p.stage === "extracting" && !unpacking) {
                unpacking = true;
                step("download", { status: "done", percent: 100, bytes: null });
                step("unpack", { status: "running" });
            }
        });
        step("download", { status: "done", percent: 100, bytes: null });
        step("unpack", { status: "done" });
        if (signal.aborted) throw new Error("setup was stopped");
        if (!(await this.executable())) throw new Error("The browser package has no program in it.");
        // the browser this panel used to unpack into its own folder, before it was a package
        for (const old of fs.readdirSync(this.deps.dir)) {
            if (/^helium-[\d.]+(\.partial)?$/.test(old)) fs.rmSync(path.join(this.deps.dir, old), { recursive: true, force: true });
        }
    }

    private async doStart() {
        if (!this.record.installed) throw new Error("Set up the computer first.");
        if (this.on) return;
        const abort = (this.abort = new AbortController());
        try {
            if (!(await this.executable())) {
                // no browser package yet (set up before it was one): fetched like a setup, the profile and home folder kept
                await this.doInstall(false);
                return;
            }
            this.set({ phase: "starting", error: null, steps: [] });
            await this.launch(abort.signal);
            this.set({ phase: "ready" });
        } catch (e) {
            await this.kill();
            this.set({ phase: "failed", error: errorText(e) });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    private profileDir() {
        return path.join(this.deps.dir, "profile");
    }
    private downloadingDir() {
        return path.join(this.deps.dir, "downloading");
    }

    /** The browser's own home as macOS sees it (not the agent's home folder): the Library it writes, like its crash database, stays in here. */
    private systemHomeDir() {
        return path.join(this.deps.dir, "system");
    }

    /**
     * The profile's own settings that keep the browser to its proxy and ready to use: WebRTC sends no UDP
     * around the proxy (its command-line switch is ignored; this pref is not), and Helium's first-run page
     * is done, with Helium's services off. Local State, shared by the profile's people, turns Helium's crash
     * reporting off, which also discards any reports it kept. The browser owns the rest of each file; an unreadable one is left alone
     * and starting stops.
     */
    private seedPreferences() {
        this.editSettings(path.join(this.profileDir(), "Default", "Preferences"), (prefs) => {
            prefs.webrtc = { ...prefs.webrtc, ip_handling_policy: "disable_non_proxied_udp", multiple_routes_enabled: false, nonproxied_udp_enabled: false };
            // Helium's own cloud (filter lists, bangs, update checks, push, spellcheck, extension proxy) stays off, and
            // pages are told not to sell or share what they see (Global Privacy Control)
            prefs.helium = { ...prefs.helium, completed_onboarding: true, global_privacy_control: true, services: { ...prefs.helium?.services, enabled: false } };
            prefs.browser = { ...prefs.browser, has_seen_welcome_page: true };
            prefs.download = { ...prefs.download, prompt_for_download: false };
        });
        this.editSettings(path.join(this.profileDir(), "Local State"), (state) => {
            // Helium's CrashReportingMode: -1 disabled, 0 ask, 1 automatic
            state.helium = { ...state.helium, crash_reporting: { ...state.helium?.crash_reporting, mode: -1 } };
        });
    }

    private editSettings(file: string, edit: (settings: Record<string, any>) => void) {
        let settings: Record<string, any> = {};
        if (fs.existsSync(file)) {
            try {
                settings = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
                throw new Error(`The browser's settings (${file}) are unreadable; they were left as they are.`);
            }
        }
        edit(settings);
        writeAtomic(file, JSON.stringify(settings));
    }

    private async launch(signal: AbortSignal): Promise<void> {
        const exe = await this.executable();
        if (!exe) throw new Error("The browser isn't installed; set the computer up again.");
        this.home.ensure();
        fs.rmSync(this.downloadingDir(), { recursive: true, force: true });
        fs.mkdirSync(this.downloadingDir(), { recursive: true });
        this.seedPreferences();
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
            this.writeRecord();
            await this.kill();
            return this.launch(signal);
        }
        this.listen(cdp);
        await cdp.send("Target.setDiscoverTargets", { discover: true });
        await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: this.downloadingDir(), eventsEnabled: true });
        const { targetInfos } = await cdp.send<{ targetInfos: any[] }>("Target.getTargets");
        for (const t of targetInfos) this.track(t);
        await this.checkWebRtc();
    }

    /** The profile's WebRTC policy is what keeps UDP on the proxy's side: observed at every start, not assumed. */
    private async checkWebRtc() {
        const blank = [...this.tabs.values()][0];
        if (!blank) throw new Error("The browser opened no page to check itself in.");
        const n = await this.evaluate(blank, WEBRTC_CANDIDATES_JS, 10_000);
        if (n !== 0) throw new Error(`The browser could send WebRTC traffic around its proxy (${n} routes), so it was stopped.`);
        await this.cdp!.send("Target.closeTarget", { targetId: blank.targetId });
        this.untrack(blank.targetId);
        // the check's page was nobody's window: the agent's first is window 1
        if (!this.tabs.size) this.nextId = 1;
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
        for (const w of [...this.exitWaiters]) w(code);
        this.exitWaiters.clear();
        const unexpected = !this.stopping && this.state.phase === "ready";
        this.teardown();
        if (unexpected) {
            this.releaseControl();
            this.set({ phase: "failed", error: this.exitReason() });
        }
    }

    private async onConnectionLost(cdp: Cdp, why: string) {
        if (this.cdp !== cdp || this.stopping) return;
        if (this.state.phase !== "ready") return; // starting fails on its own
        await this.exclusive(async () => {
            if (this.cdp !== cdp) return;
            await this.kill();
            this.set({ phase: "failed", error: `Lost the browser: ${why}` });
        });
    }

    private teardown() {
        const cdp = this.cdp;
        this.cdp = null;
        cdp?.close();
        const proxy = this.proxy;
        this.proxy = null;
        void proxy?.close();
        for (const t of this.tabs.values()) for (const w of t.loads) w();
        this.tabs.clear();
        this.byId.clear();
        this.nextId = 1;
        this.downloads.clear();
        this.signIn = null;
    }

    /** Stop the browser and observe its exit: SIGTERM, then SIGKILL past the grace. */
    private async kill() {
        this.stopping = true;
        try {
            if (this.running || (await this.deps.host.exists(BROWSER_PROC_ID))) {
                const gone = new Promise<void>((ok) => this.exitWaiters.add(() => ok()));
                if (!(await this.deps.host.exists(BROWSER_PROC_ID))) this.onExited();
                else {
                    await this.deps.host.kill(BROWSER_PROC_ID, "SIGTERM");
                    const late = await Promise.race([gone.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), STOP_GRACE_MS))]);
                    if (late) {
                        await this.deps.host.kill(BROWSER_PROC_ID, "SIGKILL");
                        await gone;
                    }
                }
            }
        } finally {
            this.teardown();
            this.stopping = false;
        }
    }

    // ------------------------------------------------------------- the browser's tabs

    private listen(cdp: Cdp) {
        const bySession = (sessionId?: string) => [...this.tabs.values()].find((t) => t.sessionId === sessionId);
        cdp.on("Target.targetCreated", (p) => this.track(p.targetInfo));
        cdp.on("Target.targetInfoChanged", (p) => {
            const t = this.tabs.get(p.targetInfo?.targetId);
            if (t) Object.assign(t, { title: String(p.targetInfo.title ?? ""), url: String(p.targetInfo.url ?? "") });
        });
        cdp.on("Target.targetDestroyed", (p) => this.untrack(p.targetId));
        cdp.on("Target.detachedFromTarget", (p) => {
            const t = bySession(p.sessionId);
            if (t) Object.assign(t, { sessionId: null, world: null });
        });
        cdp.on("Page.javascriptDialogOpening", (p, s) => {
            const t = bySession(s);
            if (!t) return;
            const type = (["alert", "confirm", "prompt", "beforeunload"] as const).find((x) => x === p.type) ?? "alert";
            t.dialog = { type, message: String(p.message ?? "").slice(0, 500) };
            for (const w of t.dialogWaiters) w();
            t.dialogWaiters.clear();
        });
        cdp.on("Page.javascriptDialogClosed", (_p, s) => {
            const t = bySession(s);
            if (t) t.dialog = null;
        });
        cdp.on("Page.fileChooserOpened", (p, s) => {
            const t = bySession(s);
            if (t && Number.isInteger(p.backendNodeId)) t.chooser = { backendNodeId: p.backendNodeId, multiple: p.mode === "selectMultiple" };
        });
        const loaded = (s?: string) => {
            const t = bySession(s);
            if (!t) return;
            for (const w of t.loads) w();
            t.loads.clear();
        };
        cdp.on("Page.loadEventFired", (_p, s) => loaded(s));
        // a page back from the back/forward cache, or a move within the page, has no load of its own
        cdp.on("Page.frameNavigated", (p, s) => {
            if (p.type === "BackForwardCacheRestore" && !p.frame?.parentId) loaded(s);
        });
        cdp.on("Page.navigatedWithinDocument", (_p, s) => loaded(s));
        cdp.on("Runtime.executionContextsCleared", (_p, s) => {
            const t = bySession(s);
            if (t) t.world = null;
        });
        cdp.on("Browser.downloadWillBegin", (p) => {
            if (this.downloads.size >= MAX_DOWNLOADS) {
                void cdp.send("Browser.cancelDownload", { guid: p.guid }).then(
                    () => this.note(`A download of ${String(p.suggestedFilename)} was refused: ${MAX_DOWNLOADS} are already going.`),
                    (e) => this.note(`A download of ${String(p.suggestedFilename)} is past the limit of ${MAX_DOWNLOADS} at once and couldn't be stopped: ${errorText(e)}`),
                );
                return;
            }
            const tab = [...this.tabs.values()].find((t) => t.url === p.url)?.id ?? null;
            this.downloads.set(p.guid, { guid: p.guid, name: String(p.suggestedFilename || "download"), tab });
        });
        cdp.on("Browser.downloadProgress", (p) => this.onDownload(cdp, p));
    }

    private track(info: any) {
        if (info?.type !== "page" || this.tabs.has(info.targetId)) return;
        if (this.tabs.size >= MAX_TABS) {
            void this.cdp?.send("Target.closeTarget", { targetId: info.targetId }).then(
                () => this.note(`A new window was closed: ${MAX_TABS} are open already. Close some first.`),
                (e) => this.note(`A new window is past the limit of ${MAX_TABS} and couldn't be closed: ${errorText(e)}`),
            );
            return;
        }
        const tab: Tab = {
            id: this.nextId++,
            targetId: info.targetId,
            sessionId: null,
            attaching: null,
            title: String(info.title ?? ""),
            url: String(info.url ?? ""),
            marks: null,
            size: { width: 1272, height: 730 },
            dialog: null,
            chooser: null,
            world: null,
            loads: new Set(),
            dialogWaiters: new Set(),
            pointer: { x: 0, y: 0, buttons: 0, lastDown: null },
        };
        this.tabs.set(info.targetId, tab);
        this.byId.set(tab.id, info.targetId);
        // attached at once, so a dialog or a file picker it opens before anyone looks is still seen; a failure
        // here is tried again, and reported, by the window's next use
        void this.session(tab).catch((e) => console.warn(`[agents] couldn't attach to window ${tab.id} yet:`, errorText(e)));
    }

    untrack(targetId: string) {
        const t = this.tabs.get(targetId);
        if (!t) return;
        for (const w of t.loads) w();
        this.tabs.delete(targetId);
        this.byId.delete(t.id);
    }

    session(tab: Tab): Promise<string> {
        if (tab.sessionId) return Promise.resolve(tab.sessionId);
        tab.attaching ??= (async () => {
            const cdp = this.connection();
            const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
            await Promise.all([
                cdp.send("Page.enable", {}, sessionId),
                cdp.send("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId),
                // every tab acts focused, so typing reaches the one being used, not only the front one
                cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId),
            ]);
            tab.sessionId = sessionId;
            await this.measure(tab);
            return sessionId;
        })().finally(() => (tab.attaching = null));
        return tab.attaching;
    }

    /** the title and address as they are now, not as the last event left them */
    async refreshInfo(tab: Tab) {
        const { targetInfo } = await this.connection().send<any>("Target.getTargetInfo", { targetId: tab.targetId });
        Object.assign(tab, { title: String(targetInfo?.title ?? ""), url: String(targetInfo?.url ?? "") });
    }

    /** every window's title and address as the browser has them: a change event can be missed, a listing can't be */
    async refreshAll() {
        const { targetInfos } = await this.connection().send<any>("Target.getTargets", {});
        for (const info of Array.isArray(targetInfos) ? targetInfos : []) {
            const t = this.tabs.get(info?.targetId);
            if (t) Object.assign(t, { title: String(info.title ?? ""), url: String(info.url ?? "") });
        }
    }

    connection(): Cdp {
        if (!this.cdp?.open) throw new ToolError("Your browser isn't running.");
        return this.cdp;
    }

    async measure(tab: Tab) {
        const m = await this.connection().send<any>("Page.getLayoutMetrics", {}, tab.sessionId!);
        const v = m.cssLayoutViewport ?? m.layoutViewport;
        if (v?.clientWidth && v?.clientHeight) tab.size = { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
    }

    tab(window: unknown): Tab {
        const id = Number(window);
        const targetId = Number.isInteger(id) ? this.byId.get(id) : undefined;
        const tab = targetId ? this.tabs.get(targetId) : undefined;
        if (!tab) throw new ToolError(`There's no window ${String(window)}; \`windows\` lists them.`);
        return tab;
    }

    /** Run a script in the tab's own isolated world: the page's scripts can't see it or change what it reads. */
    async evaluate(tab: Tab, expression: string, timeoutMs = 10_000): Promise<any> {
        const s = await this.session(tab);
        const cdp = this.connection();
        for (let attempt = 0; ; attempt++) {
            if (!tab.world) {
                const { frameTree } = await cdp.send<any>("Page.getFrameTree", {}, s);
                const frameId = frameTree.frame.id as string;
                const { executionContextId } = await cdp.send<any>("Page.createIsolatedWorld", { frameId, worldName: "paperboard-agent", grantUniveralAccess: false }, s);
                tab.world = { frameId, contextId: executionContextId };
            }
            try {
                const r = await cdp.send<any>(
                    "Runtime.evaluate",
                    { expression, contextId: tab.world.contextId, returnByValue: true, awaitPromise: true },
                    s,
                    timeoutMs,
                );
                if (r.exceptionDetails) throw new ToolError(`the page's script failed: ${String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200)}`);
                return r.result?.value;
            } catch (e) {
                // the page navigated: its world went with it
                if (attempt === 0 && !(e instanceof ToolError) && /context/i.test(errorText(e))) {
                    tab.world = null;
                    continue;
                }
                throw e;
            }
        }
    }

    private note(text: string) {
        this.notes.push(text);
        if (this.notes.length > NOTES_MAX) this.notes.shift();
    }

    private onDownload(cdp: Cdp, p: any) {
        const d = this.downloads.get(p.guid);
        if (!d) return;
        const temp = path.join(this.downloadingDir(), String(p.guid));
        if (p.state === "inProgress" && (p.receivedBytes > DOWNLOAD_MAX_BYTES || p.totalBytes > DOWNLOAD_MAX_BYTES)) {
            this.downloads.delete(p.guid);
            const limit = `${DOWNLOAD_MAX_BYTES / 1024 / 1024 / 1024} GB`;
            void cdp.send("Browser.cancelDownload", { guid: p.guid }).then(
                () => {
                    fs.rmSync(temp, { force: true });
                    this.note(`The download of ${d.name} was stopped: it's bigger than ${limit}.`);
                },
                (e) => this.note(`The download of ${d.name} is bigger than ${limit} and couldn't be stopped: ${errorText(e)}`),
            );
            return;
        }
        if (p.state === "completed") {
            this.downloads.delete(p.guid);
            try {
                const to = this.home.downloadName(d.name);
                fs.renameSync(temp, to);
                this.note(`Downloaded ${d.name} to ${this.home.shown(to)}.`);
            } catch (e) {
                fs.rmSync(temp, { force: true });
                this.note(`The download of ${d.name} finished but couldn't be kept: ${errorText(e)}`);
            }
        } else if (p.state === "canceled") {
            this.downloads.delete(p.guid);
            fs.rmSync(temp, { force: true });
            this.note(`The download of ${d.name} didn't finish.`);
        }
    }

    // ------------------------------------------------------------- input, for browserTools.ts and browserView.ts

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

    async mouse(tab: Tab, type: string, at: { x: number; y: number }, extra: Record<string, unknown> = {}) {
        const s = await this.session(tab);
        await this.dispatch(tab, "Input.dispatchMouseEvent", { type, x: at.x, y: at.y, buttons: tab.pointer.buttons, ...extra }, s);
        tab.pointer.x = at.x;
        tab.pointer.y = at.y;
    }

    /**
     * One input event. The browser answers it once the page has handled it, so one that opens a dialog is
     * answered only when the dialog is: the dialog opening is its answer here, and the dialog is reported.
     */
    private async dispatch(tab: Tab, method: string, params: Record<string, unknown>, s: string) {
        // the page is paused on a dialog: nothing reaches it until it's answered, and the caller reports the dialog
        if (tab.dialog) return;
        let opened = () => {};
        const dialog = new Promise<"dialog">((ok) => {
            opened = () => ok("dialog");
            tab.dialogWaiters.add(opened);
        });
        const sent = this.connection().send(method, params, s);
        try {
            await Promise.race([sent, dialog]);
        } finally {
            tab.dialogWaiters.delete(opened);
        }
        // still waiting on the dialog: its answer comes with the dialog's, or its failure is the browser's
        sent.catch((e) => {
            if (this.tabs.has(tab.targetId)) this.note(`Window ${tab.id} didn't take an input after its dialog: ${errorText(e)}`);
        });
    }

    async press(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons |= BUTTON_BITS[button];
        await this.mouse(tab, "mousePressed", at, { button, clickCount });
    }

    async lift(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons &= ~BUTTON_BITS[button];
        await this.mouse(tab, "mouseReleased", at, { button, clickCount });
    }

    async keys(tab: Tab, names: string[]) {
        const s = await this.session(tab);
        for (const name of names) {
            if (tab.dialog) {
                await this.answerDialog(tab, name);
                continue;
            }
            const events = chord(name, this.platform);
            if (typeof events === "string") throw new ToolError(events);
            for (const e of events) {
                if (tab.dialog) break; // the key before opened one
                await this.dispatch(tab, "Input.dispatchKeyEvent", e, s);
            }
            await new Promise((r) => setTimeout(r, 30));
        }
    }

    private async answerDialog(tab: Tab, key: string, promptText?: string) {
        const k = key.toLowerCase();
        if (k !== "return" && k !== "enter" && k !== "escape") throw new ToolError(`${dialogNote(tab)}`);
        await this.connection().send("Page.handleJavaScriptDialog", { accept: k !== "escape", ...(promptText === undefined ? {} : { promptText }) }, tab.sessionId!);
        tab.dialog = null;
    }

    async text(tab: Tab, text: string) {
        const s = await this.session(tab);
        if (tab.dialog) {
            if (tab.dialog.type !== "prompt") throw new ToolError(dialogNote(tab));
            await this.answerDialog(tab, "Return", text);
            return;
        }
        if (text) await this.connection().send("Input.insertText", { text }, s);
    }

    /** Wait for the tab's next load, up to a limit; true when it loaded. */
    loaded(tab: Tab, ms = LOAD_MS): { done: Promise<boolean>; cancel: () => void } {
        let cancel = () => {};
        const done = new Promise<boolean>((ok) => {
            const t = setTimeout(() => {
                tab.loads.delete(w);
                ok(false);
            }, ms);
            const w = () => {
                clearTimeout(t);
                ok(true);
            };
            tab.loads.add(w);
            cancel = () => {
                clearTimeout(t);
                tab.loads.delete(w);
                ok(false);
            };
        });
        return { done, cancel };
    }

    async navigate(tab: Tab, url: string) {
        const s = await this.session(tab);
        const load = this.loaded(tab);
        const r = await this.connection().send<any>("Page.navigate", { url }, s, LOAD_MS);
        if (r.errorText) {
            load.cancel();
            throw new ToolError(navigationError(url, r.errorText));
        }
        // a same-document navigation has no load to wait for
        if (!r.loaderId) load.cancel();
        const ok = await load.done;
        return ok ? "" : " It's still loading.";
    }

    // ------------------------------------------------------------- windows

    /** What's open as a turn starts, for the agent's instructions: windows it left open are its to close. */
    async openWindowsNote(): Promise<string> {
        if (!this.on) return `Your browser isn't running (${this.state.phase}).`;
        await this.refreshAll();
        const list = [...this.tabs.values()].sort((a, b) => a.id - b.id);
        if (!list.length) return "No browser windows are open.";
        return `Browser windows open now (close the ones you're done with):\n${list.map((t) => `- ${t.id}: ${t.title || "(untitled)"} <${t.url}>`).join("\n")}`;
    }

    /** A window of its own at an address, once its page has loaded (or is still loading: `still` says so). */
    async openWindow(url: string): Promise<{ tab: Tab; still: string }> {
        if (this.tabs.size >= MAX_TABS) throw new ToolError(`${MAX_TABS} windows are open already; close some first.`);
        // a window of its own, not a tab: a headless browser draws only its front tab, so a background tab never
        // answers a screenshot (the user's view of it hung), and resizing one tab's window resized them all
        const { targetId } = await this.connection().send<{ targetId: string }>("Target.createTarget", { url: "about:blank", newWindow: true });
        const tab = this.tabs.get(targetId) ?? (this.track({ type: "page", targetId, title: "", url: "about:blank" }), this.tabs.get(targetId));
        if (!tab) throw new ToolError("the browser didn't open a window");
        let still = "";
        try {
            if (url !== "about:blank") still = await this.navigate(tab, url);
        } catch (e) {
            // a window that never got its page isn't left behind
            try {
                await this.connection().send("Target.closeTarget", { targetId: tab.targetId });
                this.untrack(tab.targetId);
            } catch (closing) {
                throw new ToolError(`${errorText(e)} Its window ${tab.id} couldn't be closed: ${errorText(closing)}`);
            }
            throw e;
        }
        await this.refreshInfo(tab);
        return { tab, still };
    }

    /** A JPEG of a page, taken in a window opened for it and closed again: an app's picture on its card. */
    async picture(url: string): Promise<string> {
        if (!this.on) throw new Error("your computer is off, and a page's picture is taken in its browser");
        const { tab } = await this.openWindow(url);
        try {
            const s = await this.session(tab);
            const { data } = await this.connection().send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 }, s, 10_000);
            return data;
        } finally {
            await this.connection().send("Target.closeTarget", { targetId: tab.targetId });
            this.untrack(tab.targetId);
        }
    }

    /** A page printed to a PDF, as its own print CSS lays it out: in a window of its own, closed after. */
    async pdf(url: string): Promise<Buffer> {
        if (!this.on) throw new Error("the agent's computer is off, and a page is saved as a PDF in its browser. Start it in the agent's Computer page");
        const { tab } = await this.openWindow(url);
        try {
            const s = await this.session(tab);
            // its fonts first: a PDF made before they've loaded is set in the fallback
            await this.connection().send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true }, s, 10_000);
            const { data } = await this.connection().send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }, s, 30_000);
            return Buffer.from(data, "base64");
        } finally {
            await this.connection().send("Target.closeTarget", { targetId: tab.targetId });
            this.untrack(tab.targetId);
        }
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

export function dialogNote(tab: Tab): string {
    const d = tab.dialog!;
    const what = d.type === "beforeunload" ? "The page asks whether to leave it" : `The page shows a ${d.type} dialog${d.message ? `: "${d.message}"` : ""}`;
    return `${what}. Press Return to accept${d.type === "prompt" ? " (or type an answer)" : ""} or Escape to dismiss it.`;
}

function navigationError(url: string, error: string): string {
    if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error)) {
        return `Couldn't open ${url}: the site can't be reached, or it's on this computer or its local network, which your browser can't reach (${error}).`;
    }
    if (/ERR_NAME_NOT_RESOLVED/.test(error)) return `Couldn't open ${url}: there's no such site (${error}).`;
    return `Couldn't open ${url} (${error}).`;
}

