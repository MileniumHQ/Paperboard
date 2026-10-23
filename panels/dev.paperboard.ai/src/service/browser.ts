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

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LIMITS, PANEL_ID, type PageDialog, type ComputerPhase, type ComputerState, type SetupStep, type SetupStepId } from "../contract";
import { Cdp } from "./cdp";
import type { ToolResult } from "./computerMcp";
import { HELIUM_VERSION, findExecutable, heliumBuild, unpackHelium, userAgent } from "./helium";
import { HomeFolder } from "./homeFolder";
import { chord } from "./keys";
import {
    EDITABLE_JS,
    MARKS_JS,
    REMOVE_OVERLAY_JS,
    SIGN_IN_FOCUS_JS,
    SIGN_IN_MOVED_JS,
    WEBRTC_CANDIDATES_JS,
    overlayJs,
    type Mark,
} from "./pageScripts";
import { startProxy, type Proxy } from "./proxy";

export const BROWSER_PROC_ID = `${PANEL_ID}.browser`;
// TODO(remove after v0.3): the VM computer's children (QEMU and passt), stopped if a version before the browser left them running
const OLD_VM_PROCS = [`${PANEL_ID}.computer`, `${PANEL_ID}.net`];
const RECORD_FILE = "browser.json";
const RECORD_VERSION = 1;

const START_MS = 30_000;
const STOP_GRACE_MS = 2_000; // the daemon gives the whole service 3 s to stop
const LOAD_MS = 15_000;
const SETTLE_MS = 400; // after an action, for what it opens or changes to show
const MAX_TABS = 16;
const MAX_CALLS = 4;
// the user's view polls frames from every open shell; it gets its own few slots so it never starves the agent
const MAX_VIEW_CALLS = 3;
const MAX_DOWNLOADS = 8;
const DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const NOTES_MAX = 20;
const SCROLL_PX = 60;
const SCROLL_MAX = 50;
const SIZE_MAX = 8192;
const ZOOM_MAX = 6;
const GRID_STEPS = [2, 5, 10, 20, 25, 50, 100, 200];
const VIEW_MAX_EVENTS = 64;
const VIEW_MAX_TEXT = 2000;
const KEYS_MAX = 16;
const UPLOAD_MAX = 10;
/** control lasts this long past the last renewal, so a closed shell can't hold the agent off */
export const CONTROL_LEASE_MS = 20_000;
export const VIEW_TOOLS = ["view_windows", "view_frame", "view_input", "view_go", "view_close", "view_sign_in"] as const;
export type ViewTool = (typeof VIEW_TOOLS)[number];

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
    exec(command: string, args: string[], o?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    /** into the panel's storage; resolves once the bytes match sha256 */
    download(o: { url: string; targetPath: string; sha256: string; onProgress?: (percent: number) => void }): Promise<unknown>;
    which(command: string): string | null;
}

interface BrowserRecord {
    version: typeof RECORD_VERSION;
    installed: boolean;
    /** the Helium unpacked in the computer's folder */
    helium: string | null;
}

export interface BrowserDeps {
    host: ComputerHost;
    /** absolute path of the computer's folder in the panel's storage */
    dir: string;
    /** the same folder relative to the panel's storage, for downloads */
    storagePath: string;
    onState: (s: ComputerState) => void;
    platform?: NodeJS.Platform;
    arch?: string;
    controlLeaseMs?: number;
    startMs?: number;
}

class ToolError extends Error {}

interface Tab {
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
const BUTTON_NAMES = { 1: "left", 2: "middle", 3: "right" } as const;

export class BrowserComputer {
    state: ComputerState = { phase: "none", installed: false, steps: [], error: null, userControl: false };
    readonly home: HomeFolder;
    private record: BrowserRecord = { version: RECORD_VERSION, installed: false, helium: null };
    private busy: Promise<unknown> = Promise.resolve();
    private abort: AbortController | null = null;
    private exitWaiters = new Set<(code?: number) => void>();
    private offs: (() => void)[] = [];
    private stderrTail = "";
    private running = false;
    private stopping = false;
    private cdp: Cdp | null = null;
    private proxy: Proxy | null = null;
    private tabs = new Map<string, Tab>();
    private byId = new Map<number, string>();
    private nextId = 1;
    private downloads = new Map<string, Download>();
    private notes: string[] = [];
    private signIn: PendingSignIn | null = null;
    private calls = 0;
    private callQueue: (() => void)[] = [];
    private viewCalls = 0;
    private control: ReturnType<typeof setTimeout> | null = null;

    constructor(private deps: BrowserDeps) {
        this.home = new HomeFolder(path.join(deps.dir, "home"));
    }

    private get platform() {
        return this.deps.platform ?? process.platform;
    }
    private get build() {
        return heliumBuild(this.platform, this.deps.arch ?? process.arch);
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
        await this.stopOldComputer();
        try {
            this.record = this.readRecord();
        } catch (e) {
            this.set({ phase: "failed", error: e instanceof Error ? e.message : String(e) });
            return;
        }
        if (!this.build) {
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
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: RECORD_VERSION, installed: false, helium: null };
            throw e;
        }
        let r: Partial<BrowserRecord>;
        try {
            r = JSON.parse(raw);
        } catch {
            throw new Error(`The computer's record (${file}) is unreadable; it was left as it is. Set the computer up again to replace it.`);
        }
        return { version: RECORD_VERSION, installed: r.installed === true, helium: typeof r.helium === "string" ? r.helium : null };
    }

    private writeRecord() {
        const file = path.join(this.deps.dir, RECORD_FILE);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.record, null, 2));
        fs.renameSync(`${file}.tmp`, file);
    }

    private heliumDir(version = HELIUM_VERSION) {
        return path.join(this.deps.dir, `helium-${version}`);
    }

    private async doInstall(erase: boolean) {
        if (!this.build) throw new Error("no browser for this computer");
        await this.kill();
        if (erase) {
            // the browser is observed stopped first: nothing is writing its profile or home folder now
            this.record = { ...this.record, installed: false };
            this.writeRecord();
            for (const name of fs.readdirSync(this.deps.dir)) {
                if (name !== RECORD_FILE) fs.rmSync(path.join(this.deps.dir, name), { recursive: true, force: true });
            }
        }
        const abort = (this.abort = new AbortController());
        const steps: SetupStep[] = (["download", "unpack", "start"] as SetupStepId[]).map((id) => ({ id, status: "waiting", percent: null }));
        const step = (id: SetupStepId, patch: Partial<SetupStep>) => {
            const s = steps.find((x) => x.id === id)!;
            Object.assign(s, patch);
            this.set({ steps: steps.map((x) => ({ ...x })) });
        };
        this.set({ phase: "installing", error: null, steps: steps.map((x) => ({ ...x })) });
        let current: SetupStepId = "download";
        try {
            await this.fetchHelium(abort.signal, (id, patch) => {
                current = id;
                step(id, patch);
            });
            current = "start";
            step("start", { status: "running" });
            this.record = { ...this.record, installed: true, helium: HELIUM_VERSION };
            this.writeRecord();
            await this.launch(abort.signal);
            step("start", { status: "done" });
            this.set({ phase: "ready", installed: true, steps: [] });
        } catch (e) {
            await this.kill();
            step(current, { status: "failed" });
            this.set({ phase: "failed", installed: this.record.installed, error: errorText(e) });
            throw e;
        } finally {
            if (this.abort === abort) this.abort = null;
        }
    }

    /** Download and unpack the pinned browser, unless it's here already. Older ones go once it's in place. */
    private async fetchHelium(signal: AbortSignal, step: (id: SetupStepId, patch: Partial<SetupStep>) => void) {
        const build = this.build!;
        const dir = this.heliumDir();
        if (findExecutable(dir)) {
            step("download", { status: "done", percent: 100 });
            step("unpack", { status: "done" });
            return;
        }
        const archiveName = `helium-${HELIUM_VERSION}.${build.kind}`;
        step("download", { status: "running", percent: 0 });
        await this.deps.host.download({
            url: build.url,
            targetPath: `${this.deps.storagePath}/${archiveName}`,
            sha256: build.sha256,
            onProgress: (percent) => step("download", { percent: Math.round(percent) }),
        });
        step("download", { status: "done", percent: 100 });
        if (signal.aborted) throw new Error("setup was stopped");
        step("unpack", { status: "running" });
        const archive = path.join(this.deps.dir, archiveName);
        await unpackHelium({ archive, kind: build.kind, into: dir, exec: this.deps.host.exec, which: this.deps.host.which });
        fs.rmSync(archive, { force: true });
        for (const old of fs.readdirSync(this.deps.dir)) {
            if (/^helium-[\d.]+$/.test(old) && path.join(this.deps.dir, old) !== dir) fs.rmSync(path.join(this.deps.dir, old), { recursive: true, force: true });
        }
        step("unpack", { status: "done" });
    }

    private async doStart() {
        if (!this.record.installed) throw new Error("Set up the computer first.");
        if (this.state.phase === "ready" && this.cdp?.open) return;
        const abort = (this.abort = new AbortController());
        try {
            if (!findExecutable(this.heliumDir())) {
                // a new version of the browser: fetched like a setup, the profile and home folder kept
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

    /**
     * The profile's own settings that keep the browser to its proxy and ready to use: WebRTC sends no UDP
     * around the proxy (its command-line switch is ignored; this pref is not), and Helium's first-run page
     * is done. The browser owns the rest of the file; an unreadable one is left alone and starting stops.
     */
    private seedPreferences() {
        const file = path.join(this.profileDir(), "Default", "Preferences");
        let prefs: Record<string, any> = {};
        if (fs.existsSync(file)) {
            try {
                prefs = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
                throw new Error(`The browser's settings (${file}) are unreadable; they were left as they are.`);
            }
        }
        prefs.webrtc = { ...prefs.webrtc, ip_handling_policy: "disable_non_proxied_udp", multiple_routes_enabled: false, nonproxied_udp_enabled: false };
        prefs.helium = { ...prefs.helium, completed_onboarding: true };
        prefs.browser = { ...prefs.browser, has_seen_welcome_page: true };
        prefs.download = { ...prefs.download, prompt_for_download: false };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(prefs));
        fs.renameSync(`${file}.tmp`, file);
    }

    private async launch(signal: AbortSignal) {
        const exe = findExecutable(this.heliumDir());
        if (!exe) throw new Error("The browser isn't unpacked; set the computer up again.");
        this.home.ensure();
        fs.rmSync(this.downloadingDir(), { recursive: true, force: true });
        fs.mkdirSync(this.downloadingDir(), { recursive: true });
        this.seedPreferences();
        const portFile = path.join(this.profileDir(), "DevToolsActivePort");
        fs.rmSync(portFile, { force: true });
        this.stderrTail = "";
        this.proxy = await startProxy();
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
            `--user-agent=${userAgent(this.platform, this.deps.arch ?? process.arch)}`,
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
            await this.deps.host.start({ id: BROWSER_PROC_ID, command: exe, args, cwd: this.deps.dir });
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

    // TODO(remove after v0.3): with OLD_VM_PROCS. The VM's disk stays in the panel's storage (user data is kept).
    private async stopOldComputer() {
        for (const id of OLD_VM_PROCS) {
            if (!(await this.deps.host.exists(id))) continue;
            console.warn(`[ai] stopping ${id}, the agent's old VM computer: the agent's computer is a browser now (this check goes away in v0.3)`);
            const gone = new Promise<void>((ok) => {
                const off = this.deps.host.onExit(id, () => {
                    off();
                    ok();
                });
            });
            if (!(await this.deps.host.exists(id))) continue;
            await this.deps.host.kill(id, "SIGTERM");
            const late = await Promise.race([gone.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), STOP_GRACE_MS))]);
            if (late) {
                await this.deps.host.kill(id, "SIGKILL");
                await gone;
            }
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
        void this.session(tab).catch((e) => console.warn(`[ai] couldn't attach to window ${tab.id} yet:`, errorText(e)));
    }

    private untrack(targetId: string) {
        const t = this.tabs.get(targetId);
        if (!t) return;
        for (const w of t.loads) w();
        this.tabs.delete(targetId);
        this.byId.delete(t.id);
    }

    private session(tab: Tab): Promise<string> {
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
    private async refreshInfo(tab: Tab) {
        const { targetInfo } = await this.connection().send<any>("Target.getTargetInfo", { targetId: tab.targetId });
        Object.assign(tab, { title: String(targetInfo?.title ?? ""), url: String(targetInfo?.url ?? "") });
    }

    /** every window's title and address as the browser has them: a change event can be missed, a listing can't be */
    private async refreshAll() {
        const { targetInfos } = await this.connection().send<any>("Target.getTargets", {});
        for (const info of Array.isArray(targetInfos) ? targetInfos : []) {
            const t = this.tabs.get(info?.targetId);
            if (t) Object.assign(t, { title: String(info.title ?? ""), url: String(info.url ?? "") });
        }
    }

    private connection(): Cdp {
        if (!this.cdp?.open) throw new ToolError("Your browser isn't running.");
        return this.cdp;
    }

    private async measure(tab: Tab) {
        const m = await this.connection().send<any>("Page.getLayoutMetrics", {}, tab.sessionId!);
        const v = m.cssLayoutViewport ?? m.layoutViewport;
        if (v?.clientWidth && v?.clientHeight) tab.size = { width: Math.round(v.clientWidth), height: Math.round(v.clientHeight) };
    }

    private tab(window: unknown): Tab {
        const id = Number(window);
        const targetId = Number.isInteger(id) ? this.byId.get(id) : undefined;
        const tab = targetId ? this.tabs.get(targetId) : undefined;
        if (!tab) throw new ToolError(`There's no window ${String(window)}; \`windows\` lists them.`);
        return tab;
    }

    /** Run a script in the tab's own isolated world: the page's scripts can't see it or change what it reads. */
    private async evaluate(tab: Tab, expression: string, timeoutMs = 10_000): Promise<any> {
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

    // ------------------------------------------------------------- tools

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
        if (this.state.phase !== "ready" || !this.cdp?.open) {
            const why: Partial<Record<ComputerPhase, string>> = {
                none: "You don't have a computer yet; the user can set one up from the AI panel.",
                unsupported: `This machine can't run your computer: ${this.state.error ?? "unsupported"}`,
                installing: "Your computer is still being set up.",
                starting: "Your computer is still starting up; try again in a moment.",
            };
            return { isError: true, text: why[this.state.phase] ?? "Your computer is off right now." };
        }
        if (this.state.userControl) {
            return { isError: true, text: "The user has taken control of your computer. Wait until they hand it back, or ask them if they need you." };
        }
        const tool = TOOLS[name];
        if (!tool) return { isError: true, text: `unknown tool ${name}` };
        await this.slot();
        try {
            return await tool.call(this, args ?? {});
        } catch (e) {
            return { isError: true, text: errorText(e) };
        } finally {
            this.release();
        }
    }

    private async slot() {
        if (this.calls < MAX_CALLS) {
            this.calls++;
            return;
        }
        await new Promise<void>((ok) => this.callQueue.push(ok));
    }

    private release() {
        const next = this.callQueue.shift();
        if (next) next();
        else this.calls--;
    }

    /** What happened since `before`: windows that opened or closed, downloads, a dialog that's waiting. */
    private changes(before: Set<number>, tab?: Tab): string {
        const now = new Set([...this.tabs.values()].map((t) => t.id));
        const out: string[] = [];
        for (const t of this.tabs.values()) if (!before.has(t.id)) out.push(`Window ${t.id} "${t.title || t.url}" opened.`);
        for (const id of before) if (!now.has(id)) out.push(`Window ${id} closed.`);
        out.push(...this.notes.splice(0));
        if (tab?.dialog && this.tabs.has(tab.targetId)) out.push(dialogNote(tab));
        if (tab?.chooser && this.tabs.has(tab.targetId)) out.push("A file picker opened: pick files from your home folder with `upload`.");
        return out.length ? ` ${out.join(" ")}` : "";
    }

    private ids() {
        return new Set([...this.tabs.values()].map((t) => t.id));
    }

    private async settle() {
        await new Promise((r) => setTimeout(r, SETTLE_MS));
    }

    private point(tab: Tab, args: Record<string, unknown>, keys = { mark: "mark", x: "x", y: "y" }): { x: number; y: number } {
        if (args[keys.mark] !== undefined) {
            const ms = tab.marks;
            if (!ms) throw new ToolError("look at the window first so its marks are fresh");
            const n = Number(args[keys.mark]);
            if (!Number.isInteger(n) || n < 1 || n > ms.length) throw new ToolError(`mark ${String(args[keys.mark])} doesn't exist; the last look had ${ms.length}`);
            const m = ms[n - 1]!;
            return { x: m.x + Math.floor(m.w / 2), y: m.y + Math.floor(m.h / 2) };
        }
        if (args[keys.x] !== undefined && args[keys.y] !== undefined) {
            const x = Number(args[keys.x]);
            const y = Number(args[keys.y]);
            if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= tab.size.width || y >= tab.size.height) {
                throw new ToolError(`that point is outside the window (${tab.size.width}x${tab.size.height})`);
            }
            return { x, y };
        }
        throw new ToolError("give a mark number, or x and y inside the window");
    }

    private async mouse(tab: Tab, type: string, at: { x: number; y: number }, extra: Record<string, unknown> = {}) {
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

    private async press(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons |= BUTTON_BITS[button];
        await this.mouse(tab, "mousePressed", at, { button, clickCount });
    }

    private async lift(tab: Tab, at: { x: number; y: number }, button: keyof typeof BUTTON_BITS, clickCount: number) {
        tab.pointer.buttons &= ~BUTTON_BITS[button];
        await this.mouse(tab, "mouseReleased", at, { button, clickCount });
    }

    private async keys(tab: Tab, names: string[]) {
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

    private async text(tab: Tab, text: string) {
        const s = await this.session(tab);
        if (tab.dialog) {
            if (tab.dialog.type !== "prompt") throw new ToolError(dialogNote(tab));
            await this.answerDialog(tab, "Return", text);
            return;
        }
        if (text) await this.connection().send("Input.insertText", { text }, s);
    }

    /** Wait for the tab's next load, up to a limit; true when it loaded. */
    private loaded(tab: Tab, ms = LOAD_MS): { done: Promise<boolean>; cancel: () => void } {
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

    private async navigate(tab: Tab, url: string) {
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

    // the tools themselves, in COMPUTER_TOOLS order (computerTools.ts)

    async windows(): Promise<ToolResult> {
        await this.refreshAll();
        const list = [...this.tabs.values()].sort((a, b) => a.id - b.id);
        if (!list.length) return { text: "No windows are open." };
        return {
            text: list
                .map((t) => `${t.id}: ${t.title || "(untitled)"} <${t.url}> size ${t.size.width}x${t.size.height}${t.dialog ? ` (${dialogNote(t)})` : ""}`)
                .join("\n"),
        };
    }

    async open(args: Record<string, unknown>): Promise<ToolResult> {
        const url = webAddress(args.what, true);
        if (this.tabs.size >= MAX_TABS) throw new ToolError(`${MAX_TABS} windows are open already; close some first.`);
        const before = this.ids();
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
        return { text: `Opened window ${tab.id} "${tab.title || tab.url}" <${tab.url}>.${still}` + this.changes(new Set([...before, tab.id]), tab) };
    }

    async go(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const to = typeof args.to === "string" ? args.to.trim() : "";
        const before = this.ids();
        const s = await this.session(tab);
        const cdp = this.connection();
        let still = "";
        if (to === "back" || to === "forward") {
            const h = await cdp.send<any>("Page.getNavigationHistory", {}, s);
            const entry = h.entries?.[h.currentIndex + (to === "back" ? -1 : 1)];
            if (!entry) throw new ToolError(`there's no page to go ${to} to`);
            const load = this.loaded(tab);
            await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id }, s);
            still = (await load.done) ? "" : " It's still loading.";
        } else if (to === "reload") {
            const load = this.loaded(tab);
            await cdp.send("Page.reload", {}, s);
            still = (await load.done) ? "" : " It's still loading.";
        } else {
            still = await this.navigate(tab, webAddress(to, false));
        }
        await this.refreshInfo(tab);
        return { text: `Window ${tab.id} is at <${tab.url}> "${tab.title}".${still}` + this.changes(before, tab) };
    }

    async look(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const s = await this.session(tab);
        await this.connection().send("Target.activateTarget", { targetId: tab.targetId });
        if (tab.dialog) return { text: `Window ${tab.id} "${tab.title}": ${dialogNote(tab)} The page is paused until it's answered.` };
        const page = await this.evaluate(tab, MARKS_JS);
        tab.marks = page.marks as Mark[];
        tab.size = { width: page.width, height: page.height };
        const image = await this.shot(tab, overlayJs({ boxes: tab.marks.map((m, i) => ({ ...m, label: String(i + 1) })) }), { format: "png" }, s);
        const listing = tab.marks.map((m, i) => (m.name ? `${i + 1}. ${m.kind} "${m.name}"` : `${i + 1}. ${m.kind}`)).join("\n");
        let head = `Window ${tab.id} "${page.title}" <${page.url}> (${page.width}x${page.height} px; x/y coordinates are pixels from its top-left).`;
        if (page.crossFrames) head += `\n${page.crossFrames} embedded frame${page.crossFrames === 1 ? " is" : "s are"} from other sites, so ${page.crossFrames === 1 ? "its" : "their"} insides aren't marked: zoom in and use x/y there.`;
        if (tab.chooser) head += "\nA file picker is open: pick files from your home folder with `upload`.";
        return { text: head + (tab.marks.length ? "\nMarks:\n" + listing : "\nNo marks."), image };
    }

    /** A screenshot with something drawn over the page for it, taken away again whatever happens. */
    private async shot(tab: Tab, overlay: string, params: Record<string, unknown>, s: string): Promise<string> {
        await this.evaluate(tab, overlay);
        try {
            const { data } = await this.connection().send<{ data: string }>("Page.captureScreenshot", params, s);
            return data;
        } finally {
            // a page that navigated away took the overlay with it; anything else that fails here is the call's failure
            await this.evaluate(tab, REMOVE_OVERLAY_JS);
        }
    }

    async zoom(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const s = await this.session(tab);
        if (tab.dialog) throw new ToolError(dialogNote(tab));
        await this.measure(tab);
        const x = Math.max(0, Math.floor(Number(args.x)));
        const y = Math.max(0, Math.floor(Number(args.y)));
        const w = Math.min(Math.floor(Number(args.width)), tab.size.width - x);
        const h = Math.min(Math.floor(Number(args.height)), tab.size.height - y);
        if (!(w >= 8 && h >= 8)) throw new ToolError(`that region is outside the window (${tab.size.width}x${tab.size.height})`);
        const scale = Math.max(1, Math.min(ZOOM_MAX, 1280 / Math.max(w, h)));
        const step = GRID_STEPS.find((g) => g * scale >= 60) ?? GRID_STEPS.at(-1)!;
        // the latest look's marks keep their numbers here, so either way of clicking works
        const boxes = (tab.marks ?? [])
            .map((m, i) => ({ ...m, label: String(i + 1) }))
            .filter((m) => m.x < x + w && m.x + m.w > x && m.y < y + h && m.y + m.h > y);
        const { visualViewport: vv } = await this.connection().send<any>("Page.getLayoutMetrics", {}, s);
        const image = await this.shot(tab, overlayJs({ boxes, color: "blue", grid: { x, y, w, h, step, scale } }), {
            format: "png",
            // the clip is in the page's coordinates: the viewport's scroll offset moves it to what's on screen
            clip: { x: x + (vv?.pageX ?? 0), y: y + (vv?.pageY ?? 0), width: w, height: h, scale },
        }, s);
        return {
            text: `Region ${x},${y} to ${x + w},${y + h} of window ${tab.id}, enlarged ${scale.toFixed(1)}x. Grid lines every ${step} px are labelled in window coordinates: click with those x/y.`,
            image,
        };
    }

    async click(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        if (tab.dialog) throw new ToolError(dialogNote(tab));
        const at = this.point(tab, args);
        const button = (["left", "middle", "right"] as const).find((b) => b === (args.button ?? "left"));
        if (!button) throw new ToolError("button is left, middle or right");
        const before = this.ids();
        await this.mouse(tab, "mouseMoved", at);
        await this.press(tab, at, button, 1);
        await this.lift(tab, at, button, 1);
        if (args.double === true) {
            await this.press(tab, at, button, 2);
            await this.lift(tab, at, button, 2);
        }
        await this.settle();
        return { text: `Clicked at ${at.x},${at.y} in window ${tab.id}.` + this.changes(before, tab) };
    }

    async hover(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        if (tab.dialog) throw new ToolError(dialogNote(tab));
        const at = this.point(tab, args);
        await this.mouse(tab, "mouseMoved", at);
        await new Promise((r) => setTimeout(r, 600));
        return { text: `Pointer resting at ${at.x},${at.y}.` };
    }

    async drag(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        if (tab.dialog) throw new ToolError(dialogNote(tab));
        const from = this.point(tab, args);
        if (args.to_mark === undefined && (args.to_x === undefined || args.to_y === undefined)) throw new ToolError("give to_mark, or to_x and to_y");
        const to = this.point(tab, args, { mark: "to_mark", x: "to_x", y: "to_y" });
        const before = this.ids();
        await this.mouse(tab, "mouseMoved", from);
        await this.press(tab, from, "left", 1);
        try {
            // in steps, so the page sees a drag rather than a jump
            for (let i = 1; i <= 10; i++) {
                await this.mouse(tab, "mouseMoved", { x: from.x + Math.round(((to.x - from.x) * i) / 10), y: from.y + Math.round(((to.y - from.y) * i) / 10) });
                await new Promise((r) => setTimeout(r, 20));
            }
        } finally {
            await this.lift(tab, to, "left", 1);
        }
        await this.settle();
        return { text: `Dragged from ${from.x},${from.y} to ${to.x},${to.y}.` + this.changes(before, tab) };
    }

    async type(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const before = this.ids();
        await this.text(tab, String(args.text ?? ""));
        if (args.enter === true && !tab.dialog) await this.keys(tab, ["Return"]);
        await this.settle();
        return { text: "Typed." + this.changes(before, tab) };
    }

    async key(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const names = String(args.keys ?? "").split(/\s+/).filter(Boolean);
        if (!names.length || names.length > KEYS_MAX) throw new ToolError(`press 1 to ${KEYS_MAX} keys at a time`);
        const before = this.ids();
        await this.keys(tab, names);
        await this.settle();
        return { text: `Pressed ${names.join(" ")}.` + this.changes(before, tab) };
    }

    async scroll(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        if (tab.dialog) throw new ToolError(dialogNote(tab));
        const at = args.mark !== undefined || args.x !== undefined ? this.point(tab, args) : { x: Math.floor(tab.size.width / 2), y: Math.floor(tab.size.height / 2) };
        const amount = args.amount === undefined ? 5 : Number(args.amount);
        if (!Number.isInteger(amount) || !amount || Math.abs(amount) > SCROLL_MAX) throw new ToolError(`amount is 1 to ${SCROLL_MAX} steps, negative to scroll up`);
        await this.mouse(tab, "mouseWheel", at, { deltaX: 0, deltaY: amount * SCROLL_PX });
        await this.settle();
        return { text: `Scrolled ${amount > 0 ? "down" : "up"} ${Math.abs(amount)}.` };
    }

    async place(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const width = args.width === undefined ? tab.size.width : Number(args.width);
        const height = args.height === undefined ? tab.size.height : Number(args.height);
        if (![width, height].every((n) => Number.isInteger(n) && n >= 200 && n <= SIZE_MAX)) throw new ToolError(`sizes are 200 to ${SIZE_MAX} px`);
        const cdp = this.connection();
        const { windowId, bounds } = await cdp.send<any>("Browser.getWindowForTarget", { targetId: tab.targetId });
        // the window's own frame around the page, the same before and after
        const dx = bounds.width - tab.size.width;
        const dy = bounds.height - tab.size.height;
        await cdp.send("Browser.setWindowBounds", { windowId, bounds: { width: width + dx, height: height + dy } });
        await this.settle();
        await this.measure(tab);
        tab.marks = null;
        return { text: `Window ${tab.id} is ${tab.size.width}x${tab.size.height} now.` };
    }

    async close(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        await this.connection().send("Target.closeTarget", { targetId: tab.targetId });
        this.untrack(tab.targetId);
        return { text: "Closed." };
    }

    async upload(args: Record<string, unknown>): Promise<ToolResult> {
        const tab = this.tab(args.window);
        const chooser = tab.chooser;
        if (!chooser) throw new ToolError("No file picker is open in that window: click the page's upload button first.");
        const files = Array.isArray(args.files) ? args.files : [args.files];
        if (!files.length || files.length > UPLOAD_MAX) throw new ToolError(`pick 1 to ${UPLOAD_MAX} files`);
        if (files.length > 1 && !chooser.multiple) throw new ToolError("this picker takes one file");
        const paths = files.map((f) => {
            const full = this.home.resolve(f);
            if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) throw new ToolError(`there's no file at ${this.home.shown(full)}`);
            return full;
        });
        const before = this.ids();
        await this.connection().send("DOM.setFileInputFiles", { files: paths, backendNodeId: chooser.backendNodeId }, await this.session(tab));
        tab.chooser = null;
        await this.settle();
        return { text: `Picked ${paths.map((p) => this.home.shown(p)).join(", ")}.` + this.changes(before, tab) };
    }

    files(args: Record<string, unknown>): ToolResult {
        return { text: this.home.list(args.folder ?? "~") };
    }

    // ------------------------------------------------------------- sign-in

    /** The agent's picks for a sign-in, checked against its latest look: the page's site and a picture of them. */
    async signInPrepare(args: Record<string, unknown>): Promise<ToolResult> {
        const rid = String(args.id ?? "");
        if (!/^[a-z0-9]{6,32}$/.test(rid)) throw new ToolError("a sign-in id is lowercase letters and digits");
        const tab = this.tab(args.window);
        const ms = tab.marks;
        if (!ms) throw new ToolError("look at the browser window first so its marks are fresh");
        const fields = args.fields;
        if (!Array.isArray(fields) || fields.length < 1 || fields.length > LIMITS.signIn.fields) throw new ToolError(`pick 1 to ${LIMITS.signIn.fields} fields`);
        const mark = (n: unknown) => {
            const i = Number(n);
            if (!Number.isInteger(i) || i < 1 || i > ms.length) throw new ToolError(`mark ${String(n)} doesn't exist; the last look had ${ms.length}`);
            return [i, ms[i - 1]!] as const;
        };
        const picked = fields.map(mark);
        // no button marked: Enter is pressed in the last field (a page whose button is greyed out until typed in)
        const submit = args.submit !== undefined && args.submit !== null ? mark(args.submit) : null;
        const numbers = [...picked.map(([n]) => n), ...(submit ? [submit[0]] : [])];
        if (new Set(numbers).size !== numbers.length) throw new ToolError("each field, and the submit button, is a different mark");
        for (const [n, m] of picked) if (!["entry", "text", "password text"].includes(m.kind)) throw new ToolError(`mark ${n} is a ${m.kind}, not a text field`);
        const site = siteOf(tab.url);
        const boxes = [...picked.map(([, m], i) => ({ ...m, label: String(i + 1) })), ...(submit ? [{ ...submit[1], label: "submit" }] : [])];
        const s = await this.session(tab);
        const image = await this.shot(tab, overlayJs({ boxes }), { format: "png" }, s);
        const centre = (m: Mark) => ({ x: m.x + Math.floor(m.w / 2), y: m.y + Math.floor(m.h / 2) });
        this.signIn = { id: rid, targetId: tab.targetId, window: tab.id, site, fields: picked.map(([, m]) => centre(m)), submit: submit ? centre(submit[1]) : null };
        return { text: JSON.stringify({ site, fields: picked.map(([, m]) => ({ secret: m.kind === "password text" })) }), image };
    }

    /** The user's values, typed into the fields the waiting request named, then submit pressed. Used once. */
    private async signInFill(args: Record<string, unknown>) {
        const p = this.signIn;
        if (!p || p.id !== args.id) throw new ToolError("that sign-in isn't waiting anymore");
        const values = args.values;
        if (!Array.isArray(values) || values.length !== p.fields.length || !values.every((v) => typeof v === "string" && v.length <= LIMITS.signIn.valueChars)) {
            throw new ToolError(`one value per field, each at most ${LIMITS.signIn.valueChars} characters`);
        }
        this.signIn = null; // used once, whatever happens next
        const tab = this.tabs.get(p.targetId);
        if (!tab) throw new ToolError("that page isn't open anymore");
        const onSite = async () => {
            const [origin] = await this.evaluate(tab, EDITABLE_JS);
            if (siteOf(origin) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
        };
        if (siteOf(tab.url) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
        const s = await this.session(tab);
        for (const [i, at] of p.fields.entries()) {
            const value = values[i] as string;
            await this.mouse(tab, "mouseMoved", at);
            await this.press(tab, at, "left", 1);
            await this.lift(tab, at, "left", 1);
            await new Promise((r) => setTimeout(r, 150));
            const [origin, editable, maxLength] = await this.evaluate(tab, EDITABLE_JS);
            if (siteOf(origin) !== p.site) throw new ToolError(`the page isn't on ${p.site} anymore`);
            if (!editable) throw new ToolError(`field ${i + 1} didn't take the cursor; the page may have changed`);
            if (maxLength > 0 && maxLength < value.length) await this.typeSplit(tab, s, value);
            else await this.connection().send("Input.insertText", { text: value }, s);
        }
        await onSite();
        if (p.submit) {
            await this.mouse(tab, "mouseMoved", p.submit);
            await this.press(tab, p.submit, "left", 1);
            await this.lift(tab, p.submit, "left", 1);
        } else await this.keys(tab, ["Return"]); // the last field still has the cursor
        return { ok: true };
    }

    /** A code longer than its box: a key at a time, moving to the next box whenever the site leaves the cursor in a full one. */
    private async typeSplit(tab: Tab, s: string, value: string) {
        const chars = [...value];
        for (const [i, c] of chars.entries()) {
            await this.evaluate(tab, SIGN_IN_FOCUS_JS);
            const code = /^[0-9]$/.test(c) ? `Digit${c}` : /^[a-z]$/i.test(c) ? `Key${c.toUpperCase()}` : "";
            const vk = /^[a-z0-9]$/i.test(c) ? c.toUpperCase().charCodeAt(0) : 0;
            await this.connection().send("Input.dispatchKeyEvent", { type: "keyDown", key: c, code, windowsVirtualKeyCode: vk, text: c, unmodifiedText: c }, s);
            await this.connection().send("Input.dispatchKeyEvent", { type: "keyUp", key: c, code, windowsVirtualKeyCode: vk }, s);
            await new Promise((r) => setTimeout(r, 30)); // the site's own handler moves the cursor
            if (i < chars.length - 1 && (await this.evaluate(tab, SIGN_IN_MOVED_JS))) await this.keys(tab, ["Tab"]);
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

    // ------------------------------------------------------------- the user's view

    /** The user looking at (and, with control, using) the browser's windows. */
    async view(tool: ViewTool, args: Record<string, unknown>): Promise<unknown> {
        if (!VIEW_TOOLS.includes(tool)) throw new Error(`not a view: ${tool}`);
        if ((tool === "view_input" || tool === "view_go") && !this.state.userControl) throw new Error("Take control of the computer first.");
        if (this.state.phase !== "ready" || !this.cdp?.open) throw new Error("The computer isn't on.");
        if (this.viewCalls >= MAX_VIEW_CALLS) throw new Error("The computer is busy showing other views; try again.");
        this.viewCalls++;
        try {
            switch (tool) {
                case "view_windows":
                    await this.refreshAll();
                    return {
                        windows: [...this.tabs.values()]
                            .sort((a, b) => a.id - b.id)
                            .map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, app: "Helium", width: t.size.width, height: t.size.height })),
                    };
                case "view_frame":
                    return await this.frame(args);
                case "view_input":
                    return await this.input(args);
                case "view_go":
                    await this.go(args);
                    return { ok: true };
                case "view_close":
                    await this.close(args);
                    return { ok: true };
                case "view_sign_in":
                    return await this.signInFill(args);
            }
        } catch (e) {
            throw e instanceof ToolError ? new Error(e.message) : e;
        } finally {
            this.viewCalls--;
        }
    }

    private async frame(args: Record<string, unknown>) {
        const tab = this.tab(args.window);
        // a page waiting on a dialog can't be pictured: the last picture stands, with the dialog to answer
        if (tab.dialog) return { same: true, hash: typeof args.since === "string" ? args.since : "", dialog: tab.dialog };
        const s = await this.session(tab);
        const quality = Math.max(30, Math.min(90, Number.isInteger(args.quality) ? (args.quality as number) : 72));
        const { data } = await this.connection().send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality }, s, 10_000);
        const hash = createHash("sha256").update(data).digest("hex").slice(0, 24);
        if (args.since === hash) return { same: true, hash, dialog: null };
        await this.measure(tab);
        return { frame: data, hash, width: tab.size.width, height: tab.size.height, dialog: null };
    }

    private async input(args: Record<string, unknown>) {
        const tab = this.tab(args.window);
        const events = args.events;
        if (!Array.isArray(events) || events.length > VIEW_MAX_EVENTS) throw new ToolError(`send at most ${VIEW_MAX_EVENTS} events at a time`);
        const inside = (e: Record<string, unknown>) => {
            const x = Number(e.x);
            const y = Number(e.y);
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= tab.size.width || y >= tab.size.height) throw new ToolError("that point is outside the window");
            return { x: Math.floor(x), y: Math.floor(y) };
        };
        for (const raw of events) {
            const e = (raw ?? {}) as Record<string, unknown>;
            switch (e.type) {
                case "move":
                    if (!tab.dialog) await this.mouse(tab, "mouseMoved", inside(e));
                    break;
                case "down":
                case "up": {
                    const button = BUTTON_NAMES[Number(e.button) as 1 | 2 | 3];
                    if (!button) throw new ToolError("unknown mouse button");
                    if (tab.dialog) break;
                    const at = e.x !== undefined ? inside(e) : { x: tab.pointer.x, y: tab.pointer.y };
                    if (e.type === "down") {
                        const last = tab.pointer.lastDown;
                        const again = last && last.button === Number(e.button) && Date.now() - last.at < 500 && Math.abs(last.x - at.x) <= 4 && Math.abs(last.y - at.y) <= 4;
                        const count = again ? Math.min(3, last.count + 1) : 1;
                        tab.pointer.lastDown = { at: Date.now(), x: at.x, y: at.y, button: Number(e.button), count };
                        await this.press(tab, at, button, count);
                    } else await this.lift(tab, at, button, tab.pointer.lastDown?.count ?? 1);
                    break;
                }
                case "scroll": {
                    if (tab.dialog) break;
                    const dy = Math.max(-20, Math.min(20, Math.trunc(Number(e.dy ?? 0)) || 0));
                    const dx = Math.max(-20, Math.min(20, Math.trunc(Number(e.dx ?? 0)) || 0));
                    if (dy || dx) await this.mouse(tab, "mouseWheel", inside(e), { deltaX: dx * SCROLL_PX, deltaY: dy * SCROLL_PX });
                    break;
                }
                case "key":
                    await this.keys(tab, [String(e.keys ?? "")]);
                    break;
                case "text": {
                    const text = String(e.text ?? "");
                    if (text.length > VIEW_MAX_TEXT) throw new ToolError(`type at most ${VIEW_MAX_TEXT} characters at a time`);
                    await this.text(tab, text);
                    break;
                }
                default:
                    throw new ToolError(`unknown input ${JSON.stringify(e.type)}`);
            }
        }
        return { ok: true };
    }

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

const TOOLS: Record<string, { call: (c: BrowserComputer, args: Record<string, unknown>) => ToolResult | Promise<ToolResult> }> = {
    windows: { call: (c) => c.windows() },
    open: { call: (c, a) => c.open(a) },
    go: { call: (c, a) => c.go(a) },
    look: { call: (c, a) => c.look(a) },
    zoom: { call: (c, a) => c.zoom(a) },
    click: { call: (c, a) => c.click(a) },
    hover: { call: (c, a) => c.hover(a) },
    drag: { call: (c, a) => c.drag(a) },
    type: { call: (c, a) => c.type(a) },
    key: { call: (c, a) => c.key(a) },
    scroll: { call: (c, a) => c.scroll(a) },
    place: { call: (c, a) => c.place(a) },
    close: { call: (c, a) => c.close(a) },
    upload: { call: (c, a) => c.upload(a) },
    files: { call: (c, a) => c.files(a) },
    // the service's half of a sign-in; the agent reaches it only through ask_to_sign_in
    sign_in_prepare: { call: (c, a) => c.signInPrepare(a) },
};

function dialogNote(tab: Tab): string {
    const d = tab.dialog!;
    const what = d.type === "beforeunload" ? "The page asks whether to leave it" : `The page shows a ${d.type} dialog${d.message ? `: "${d.message}"` : ""}`;
    return `${what}. Press Return to accept${d.type === "prompt" ? " (or type an answer)" : ""} or Escape to dismiss it.`;
}

/** What the user is told they're signing in to: the host, with the scheme only when it isn't https. */
export function siteOf(url: string): string {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        throw new ToolError("that page isn't a website");
    }
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname) throw new ToolError("that page isn't a website");
    return u.protocol === "https:" ? u.hostname : `http://${u.hostname}`;
}

/** A web address the agent gave, made whole (example.com is https://example.com), or why it isn't one. */
export function webAddress(what: unknown, blankAllowed: boolean): string {
    const s = typeof what === "string" ? what.trim() : "";
    if (blankAllowed && (s === "" || s === "browser" || s === "helium" || s === "about:blank")) return "about:blank";
    if (/^https?:\/\//i.test(s)) {
        try {
            return new URL(s).href;
        } catch {
            throw new ToolError(`${s} isn't a web address`);
        }
    }
    if (/^[^\s/:]+\.[^\s/:]+(:\d+)?([/?#]\S*)?$/.test(s)) return new URL(`https://${s}`).href;
    throw new ToolError(`Open a web address (https://…)${blankAllowed ? ", or `browser` for a blank page" : ""}: your computer is a web browser.`);
}

function navigationError(url: string, error: string): string {
    if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error)) {
        return `Couldn't open ${url}: the site can't be reached, or it's on this computer or its local network, which your browser can't reach (${error}).`;
    }
    if (/ERR_NAME_NOT_RESOLVED/.test(error)) return `Couldn't open ${url}: there's no such site (${error}).`;
    return `Couldn't open ${url} (${error}).`;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const newSignInId = () => randomBytes(8).toString("hex");
