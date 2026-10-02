import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import { validatePanelManifest } from "./storage";
import { isPanelId, requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import type { PaperCraneAuth } from "./auth";

interface RunningService {
    process: cp.ChildProcess;
    state: "starting" | "ready" | "stopping" | "failed";
    ready: Promise<void>;
    rejectReady: (error: Error) => void;
    exited: Promise<void>;
    restartTimer?: ReturnType<typeof setTimeout>;
    readyTimer?: ReturnType<typeof setTimeout>;
    stopped: boolean;
    crashCount: number;
    startedAt: number;
}

// How to spawn a panel service on this host. Node, Bun and Electron-as-node
// run the service module directly. A compiled PaperCrane binary embeds Bun's
// runtime, so it re-invokes its own executable in --panel-service mode and
// needs NO external Node/Bun: a remote machine running only the daemon binary
// can still run panel services. Exported pure for the decision test.
export function resolveServiceRuntime(
    execPath: string,
    versions: NodeJS.ProcessVersions,
    platform: NodeJS.Platform,
    pathEnv: string,
): { command: string; prefix: string[] } | null {
    const base = path.basename(execPath).toLowerCase();
    if (versions.electron || /^(node|bun)(\.exe)?$/.test(base)) return { command: execPath, prefix: [] };
    // embedded Bun runtime (compiled binary): run the service through our own entrypoint
    if ((versions as { bun?: string }).bun) return { command: execPath, prefix: ["--panel-service"] };
    for (const name of ["bun", "node"]) {
        for (const dir of pathEnv.split(path.delimiter)) {
            const candidate = path.join(dir, platform === "win32" ? `${name}.exe` : name);
            try { fs.accessSync(candidate, fs.constants.X_OK); return { command: candidate, prefix: [] }; }
            catch (err) { logger.debug(`[services] runtime candidate unavailable: ${candidate}`, err); }
        }
    }
    return null;
}

function runtime(): { command: string; prefix: string[] } {
    const resolved = resolveServiceRuntime(process.execPath, process.versions, process.platform, process.env.PATH || "");
    if (!resolved) throw new Error("Panel services require Node.js or Bun on this host. Install a runtime before starting this panel.");
    return resolved;
}

/** Every generation owns its child, readiness receipt and timers. No
 * in-process fallback: a cached import cannot implement stop/restart. */
export class PanelServicesManager {
    private services = new Map<string, RunningService>();
    private auth: PaperCraneAuth | null = null;
    private port = 45464;
    constructor(private baseDir = getPaperboardDir()) {}

    public init(port: number, _hostToken?: string, auth?: PaperCraneAuth): void {
        this.port = port;
        if (auth) this.auth = auth;
        this.startAll();
    }
    public setAuth(auth: PaperCraneAuth): void { this.auth = auth; }
    public tokenForPanel(panelId: string): string {
        if (!isPanelId(panelId) || !this.auth) return "";
        return this.auth.issuePanelToken(panelId);
    }
    public startAll(): void {
        const dir = path.join(this.baseDir, "panels");
        if (!fs.existsSync(dir)) return;
        for (const id of fs.readdirSync(dir)) {
            if (!isPanelId(id)) continue;
            try {
                const manifest = this.manifest(id);
                if (manifest?.autostart !== false) this.startService(id);
            } catch (err) { logger.error(`[services] ${id} could not start`, err); }
        }
    }
    private manifest(id: string) {
        const file = path.join(this.baseDir, "panels", id, "manifest.json");
        if (!fs.existsSync(file)) return null;
        return validatePanelManifest(JSON.parse(fs.readFileSync(file, "utf8")), id);
    }
    public startService(panelId: string, crashCount = 0): boolean {
        const id = requirePanelId(panelId);
        const existing = this.services.get(id);
        if (existing && !existing.stopped && existing.state !== "failed") return true;
        if (existing && !existing.stopped && existing.process.exitCode === null && existing.process.signalCode === null) {
            throw new Error(`Service ${id} must finish stopping before it can restart`);
        }
        const manifest = this.manifest(id);
        if (!manifest?.service) return false;
        const cwd = path.join(this.baseDir, "panels", id);
        const script = path.resolve(cwd, String(manifest.service));
        if (!fs.statSync(script).isFile()) throw new Error(`Service entry is not a file: ${id}`);
        const token = this.tokenForPanel(id);
        if (!token) throw new Error(`Cannot start ${id}: no scoped credential issuer`);
        const { command, prefix } = runtime();
        const env: NodeJS.ProcessEnv = { ...process.env, PAPERBOARD_PANEL_ID: id, PAPERCRANE_PANEL_TOKEN: token,
            PAPERCRANE_PORT: String(this.port), PAPERBOARD_DIR: this.baseDir };
        delete env.PAPERCRANE_TOKEN;
        if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
        const child = cp.spawn(command, [...prefix, script], { cwd, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
        let resolveReady!: () => void;
        let rejectReady!: (error: Error) => void;
        let resolveExit!: () => void;
        const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
        // startAll is intentionally asynchronous; failed readiness stays visible
        // and waitUntilReady still rejects for an installing caller.
        void ready.catch((err) => logger.error(`[services] ${id} readiness failed`, err));
        const entry: RunningService = { process: child, state: "starting", ready, rejectReady,
            exited: new Promise<void>((resolve) => { resolveExit = resolve; }), stopped: false, crashCount, startedAt: Date.now() };
        this.services.set(id, entry);
        entry.readyTimer = setTimeout(() => {
            entry.state = "failed";
            entry.stopped = true;
            rejectReady(new Error(`Service ${id} did not report ready within 20s`));
            child.kill("SIGKILL");
        }, 20_000);
        entry.readyTimer.unref?.();
        child.on("message", (message: any) => {
            if (message?.type !== "paperboard:service-ready" || message.panelId !== id || entry.stopped) return;
            clearTimeout(entry.readyTimer);
            entry.state = "ready";
            resolveReady();
        });
        child.stdout?.on("data", (chunk: Buffer) => logger.info(`[service:${id}] ${chunk.toString("utf8").slice(0, 65536)}`));
        child.stderr?.on("data", (chunk: Buffer) => logger.warn(`[service:${id}] ${chunk.toString("utf8").slice(0, 65536)}`));
        child.on("error", (err) => { entry.state = "failed"; rejectReady(err); logger.error(`[services] ${id} process error`, err); });
        child.once("close", (code) => {
            clearTimeout(entry.readyTimer);
            resolveExit();
            rejectReady(new Error(`Service ${id} exited before readiness (code ${code})`));
            if (entry.stopped || this.services.get(id) !== entry) return;
            entry.state = "failed";
            const crashes = Date.now() - entry.startedAt < 30_000 ? entry.crashCount + 1 : 1;
            logger.warn(`[services] ${id} exited (${code}); consecutive crashes: ${crashes}`);
            if (crashes > 5) return;
            entry.restartTimer = setTimeout(() => {
                if (entry.stopped || this.services.get(id) !== entry) return;
                this.services.delete(id);
                try { this.startService(id, crashes); }
                catch (err) { logger.error(`[services] ${id} restart failed`, err); }
            }, Math.min(10_000, 1000 * 2 ** (crashes - 1)));
            entry.restartTimer.unref?.();
        });
        return true;
    }
    public async waitUntilReady(id: string): Promise<void> {
        const entry = this.services.get(id);
        if (entry) await entry.ready;
    }
    public async stopService(id: string, graceMs = 3000): Promise<void> {
        const entry = this.services.get(requirePanelId(id));
        if (!entry) return;
        entry.stopped = true;
        entry.state = "stopping";
        clearTimeout(entry.restartTimer);
        clearTimeout(entry.readyTimer);
        entry.rejectReady(new Error(`Service ${id} was stopped`));
        if (entry.process.exitCode === null && entry.process.signalCode === null) {
            entry.process.kill("SIGTERM");
            const escalation = setTimeout(() => entry.process.kill("SIGKILL"), graceMs);
            let deadline: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([entry.exited, new Promise<never>((_, reject) => {
                    deadline = setTimeout(() => reject(new Error(`Service ${id} did not exit; refusing to remove its files`)), graceMs + 3000);
                })]);
            } finally { clearTimeout(escalation); clearTimeout(deadline); }
        }
        if (this.services.get(id) === entry) this.services.delete(id);
    }
    public revokePanel(id: string): void { this.auth?.revokePanelTokens(requirePanelId(id)); }
    /** Synchronous last-resort exit hook; normal removal awaits stopService. */
    public stopAll(): void {
        for (const entry of this.services.values()) {
            entry.stopped = true;
            clearTimeout(entry.restartTimer); clearTimeout(entry.readyTimer);
            entry.rejectReady(new Error("Daemon is stopping"));
            try { entry.process.kill("SIGKILL"); } catch (err) { logger.error("[services] final kill failed", err); }
        }
        this.services.clear();
    }
}
export const panelServices = new PanelServicesManager();
