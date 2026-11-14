import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import * as crypto from "crypto";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import { validatePanelManifest } from "./panelManifest";
import { DEFAULT_LISTEN_PORT } from "./cli";
import { isPanelId, requirePanelId } from "../../../packages/paperapi/src/panelIdentity";
import type { PaperCraneAuth } from "./auth";
import type { MonitorLifecycle, MonitorServiceRecord } from "../../../packages/paperapi/src/monitorProtocol";
import type { BackupEnded } from "./backups/types";

type ServiceChange = Omit<MonitorServiceRecord, "type" | "at" | "panel">;

interface RunningService {
    process: cp.ChildProcess;
    state: "starting" | "ready" | "stopping" | "failed";
    ready: Promise<void>;
    rejectReady: (error: Error) => void;
    exited: Promise<void>;
    restartTimer?: ReturnType<typeof setTimeout>;
    readyTimer?: ReturnType<typeof setTimeout>;
    stopped: boolean;
    /** killed for not getting ready: no restart, but not a stop anyone asked for */
    timedOut?: boolean;
    crashCount: number;
    startedAt: number;
    /** the service said, when it became ready, that it gets ready for backups */
    beforeBackup?: boolean;
    beforeRestore?: boolean;
    /** ... and that it hears backups and restores end */
    afterBackup?: boolean;
    afterRestore?: boolean;
    /** ... and that it stops its own processes for an update, and starts them after */
    beforeUpdate?: boolean;
    afterUpdate?: boolean;
    /** the one backup, restore or update it is getting ready for now */
    backupPrepare?: { requestId: string; settle: (error: Error | null) => void };
    /** the end of what it wrote to stderr: why it exited, when it says */
    stderrTail: string;
}

const STDERR_TAIL_BYTES = 2000;

// What a service last wrote to stderr, as one line short enough for a
// lifecycle record: a service whose start fails exits 1 with the reason
// there. When it threw, the error lines are the reason ("error: ..." is
// Bun's plain Error); the source excerpt Bun prints around a throw (a
// minified bundle's lines, which carry raw newlines) and the stack are left
// out. Otherwise its last lines are, without stack frames.
function exitReason(stderrTail: string): string | undefined {
    const lines = stderrTail.split("\n").map((line) => line.trim());
    const thrown = lines.filter((line) => /^(error|(?:[A-Z]\w*)?Error)(\s*\[[^\]]*\])?: \S/.test(line)).map((line) => line.replace(/^error: /, ""));
    const kept = thrown.length ? [...new Set(thrown)] : lines.map((line) => line.replace(/(^|\s)\d+ \|.*$/, "").trim())
        .filter((line) => line && !/^at\s/.test(line) && !/^\^+$/.test(line));
    return kept.length ? kept.join(" · ").slice(-500) : undefined;
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
    private port = DEFAULT_LISTEN_PORT;
    // who hears about services starting, getting ready, exiting and failing
    // (the traffic monitor); empty unless someone is watching
    private lifecycleListeners = new Set<(change: MonitorLifecycle) => void>();
    // why each panel's service last failed or exited unasked, until it is
    // ready again: the panel list carries it, so the shell can say why
    private failures = new Map<string, string>();
    constructor(private baseDir = getPaperboardDir()) {}

    /** Hears every service state change from now on; returns the unsubscribe. */
    public onLifecycle(listener: (change: MonitorLifecycle) => void): () => void {
        this.lifecycleListeners.add(listener);
        return () => this.lifecycleListeners.delete(listener);
    }
    private announce(panel: string, change: ServiceChange): void {
        if (change.state === "ready") this.failures.delete(panel);
        else if (change.state === "failed" || change.state === "exited") {
            this.failures.set(panel, change.error ?? `It exited with code ${change.code ?? "unknown"}`);
        }
        for (const listener of this.lifecycleListeners) {
            try {
                listener({ type: "service", panel, ...change });
            } catch (err) { logger.error(`[services] lifecycle listener failed for ${panel}`, err); }
        }
    }

    public init(port: number, auth?: PaperCraneAuth): void {
        this.port = port;
        if (auth) this.auth = auth;
        this.startAll();
    }
    /** Why the panel's service last failed or exited unasked; undefined once it is ready again. */
    public failure(panelId: string): string | undefined {
        return this.failures.get(panelId);
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
            } catch (err) {
                logger.error(`[services] ${id} could not start`, err);
                this.announce(id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
            }
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
            exited: new Promise<void>((resolve) => { resolveExit = resolve; }), stopped: false, crashCount, startedAt: Date.now(), stderrTail: "" };
        this.services.set(id, entry);
        this.announce(id, { state: "starting", ...(child.pid !== undefined ? { pid: child.pid } : {}) });
        entry.readyTimer = setTimeout(() => {
            entry.state = "failed";
            entry.stopped = true;
            entry.timedOut = true;
            this.announce(id, { state: "failed", error: `did not report ready within 20s` });
            rejectReady(new Error(`Service ${id} did not report ready within 20s`));
            child.kill("SIGKILL");
        }, 20_000);
        entry.readyTimer.unref?.();
        child.on("message", (message: any) => {
            if (["paperboard:before-backup-done", "paperboard:before-restore-done", "paperboard:before-update-done"].includes(message?.type)) {
                const pending = entry.backupPrepare;
                if (pending && message.requestId === pending.requestId) {
                    pending.settle(message.error ? new Error(String(message.error).slice(0, 500)) : null);
                }
                return;
            }
            if (message?.type !== "paperboard:service-ready" || message.panelId !== id || entry.stopped) return;
            clearTimeout(entry.readyTimer);
            entry.beforeBackup = message.beforeBackup === true;
            entry.beforeRestore = message.beforeRestore === true;
            entry.afterBackup = message.afterBackup === true;
            entry.afterRestore = message.afterRestore === true;
            entry.beforeUpdate = message.beforeUpdate === true;
            entry.afterUpdate = message.afterUpdate === true;
            entry.state = "ready";
            this.announce(id, { state: "ready", ...(child.pid !== undefined ? { pid: child.pid } : {}) });
            resolveReady();
        });
        child.stdout?.on("data", (chunk: Buffer) => logger.info(`[service:${id}] ${chunk.toString("utf8").slice(0, 65536)}`));
        child.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            entry.stderrTail = (entry.stderrTail + text).slice(-STDERR_TAIL_BYTES);
            logger.warn(`[service:${id}] ${text.slice(0, 65536)}`);
        });
        child.on("error", (err) => {
            entry.state = "failed";
            this.announce(id, { state: "failed", error: err.message });
            rejectReady(err);
            logger.error(`[services] ${id} process error`, err);
        });
        child.once("close", (code) => {
            clearTimeout(entry.readyTimer);
            // an exit nobody asked for carries the service's own last words,
            // so the monitor and an installing caller say why, not only the
            // code; one killed for not getting ready was not asked to stop
            const asked = entry.stopped && !entry.timedOut;
            const reason = asked ? undefined : exitReason(entry.stderrTail) ?? (entry.timedOut ? "did not report ready within 20s" : undefined);
            this.announce(id, asked ? { state: "stopped", code } : { state: "exited", code, ...(reason ? { error: reason } : {}) });
            entry.backupPrepare?.settle(new Error(`Service ${id} exited while getting ready`));
            resolveExit();
            rejectReady(new Error(`Service ${id} exited before it was ready (code ${code})${reason ? `: ${reason}` : ""}`));
            if (entry.stopped || this.services.get(id) !== entry) return;
            entry.state = "failed";
            const crashes = Date.now() - entry.startedAt < 30_000 ? entry.crashCount + 1 : 1;
            logger.warn(`[services] ${id} exited (${code}); consecutive crashes: ${crashes}`);
            if (crashes > 5) return;
            entry.restartTimer = setTimeout(() => {
                if (entry.stopped || this.services.get(id) !== entry) return;
                this.services.delete(id);
                try { this.startService(id, crashes); }
                catch (err) {
                    logger.error(`[services] ${id} restart failed`, err);
                    this.announce(id, { state: "failed", error: err instanceof Error ? err.message : String(err) });
                }
            }, Math.min(10_000, 1000 * 2 ** (crashes - 1)));
            entry.restartTimer.unref?.();
        });
        return true;
    }
    /**
     * Asks a ready service that handles it (its definition has beforeBackup)
     * to get ready for a copy of its data: a game server writes its world
     * out and stops writing. Resolves false when the service does not take
     * part, rejects when it failed or did not answer in time.
     */
    public async prepareForBackup(id: string, sourceId?: string, timeoutMs = 300_000, operation: "backup" | "restore" = "backup"): Promise<boolean> {
        const entry = this.services.get(requirePanelId(id));
        if (!entry || entry.stopped || entry.state !== "ready" || !(operation === "backup" ? entry.beforeBackup : entry.beforeRestore)) return false;
        return this.askToPrepare(id, entry, operation, { sourceId }, timeoutMs);
    }
    /**
     * Asks a ready service that handles it (its definition has
     * beforeUpdate) to stop the listed processes its own way before an
     * update. Resolves false when the service does not take part, rejects
     * when it refused or did not answer in time.
     */
    public async prepareForUpdate(id: string, processes: string[], timeoutMs = 120_000): Promise<boolean> {
        const entry = this.services.get(requirePanelId(id));
        if (!entry || entry.stopped || entry.state !== "ready" || !entry.beforeUpdate) return false;
        return this.askToPrepare(id, entry, "update", { processes }, timeoutMs);
    }
    /** Tells a ready service that hears it (afterUpdate) how an update that stopped its processes ended. */
    public tellUpdateEnded(id: string, ended: { processes: string[]; ok: boolean; error?: string }): boolean {
        const entry = this.services.get(requirePanelId(id));
        if (!entry || entry.stopped || entry.state !== "ready" || !entry.afterUpdate) return false;
        entry.process.send({ type: "paperboard:after-update", ended }, (err) => {
            if (err) logger.error(`[services] ${id} was not told its update ended`, err);
        });
        return true;
    }
    private async askToPrepare(id: string, entry: RunningService, operation: "backup" | "restore" | "update", payload: Record<string, unknown>, timeoutMs: number): Promise<boolean> {
        if (entry.backupPrepare) throw new Error(`Service ${id} is already getting ready for something else`);
        const requestId = crypto.randomUUID();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const settle = (error: Error | null) => {
                    if (settled) return;
                    settled = true;
                    if (error) reject(error);
                    else resolve();
                };
                entry.backupPrepare = { requestId, settle };
                timer = setTimeout(() => settle(new Error(`Service ${id} did not get ready for the ${operation} within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
                timer.unref?.();
                entry.process.send({ type: `paperboard:before-${operation}`, requestId, ...payload }, (err) => { if (err) settle(err); });
            });
        } finally {
            clearTimeout(timer);
            // set inside the promise above, which narrowing does not see
            const current = entry.backupPrepare as RunningService["backupPrepare"];
            if (current?.requestId === requestId) entry.backupPrepare = undefined;
        }
        return true;
    }
    /**
     * Tells a ready service that hears it (its definition has afterBackup or
     * afterRestore) how a backup or restore of its data ended. A service
     * that is stopped, not ready yet, or doesn't take part is not told.
     */
    public tellBackupEnded(id: string, operation: "backup" | "restore", ended: BackupEnded): void {
        const entry = this.services.get(requirePanelId(id));
        if (!entry || entry.stopped || entry.state !== "ready" || !(operation === "backup" ? entry.afterBackup : entry.afterRestore)) return;
        entry.process.send({ type: `paperboard:after-${operation}`, ended }, (err) => {
            if (err) logger.error(`[services] ${id} was not told its ${operation} ended`, err);
        });
    }
    /** Starts the panel's service and waits until it is ready; false when the panel declares none. */
    public async startAndWait(id: string): Promise<boolean> {
        if (!this.startService(id)) return false;
        await this.waitUntilReady(id);
        return true;
    }
    public async waitUntilReady(id: string): Promise<void> {
        const entry = this.services.get(id);
        if (entry) await entry.ready;
    }
    /** true while the service is meant to run (started and not stopped),
     * including while it waits to restart after a crash */
    public isActive(id: string): boolean {
        const entry = this.services.get(requirePanelId(id));
        return !!entry && !entry.stopped;
    }
    /** Live service children, including those whose stop has not finished. */
    public runningCount(): number {
        let count = 0;
        for (const entry of this.services.values()) {
            if (entry.process.pid !== undefined && entry.process.exitCode === null && entry.process.signalCode === null) count++;
        }
        return count;
    }
    /** Each running service's process, by panel. */
    public processRoots(): Array<{ panelId: string; pid: number }> {
        const roots: Array<{ panelId: string; pid: number }> = [];
        for (const [panelId, entry] of this.services) {
            const pid = entry.process.pid;
            if (pid !== undefined && entry.process.exitCode === null && entry.process.signalCode === null) roots.push({ panelId, pid });
        }
        return roots;
    }
    public async stopService(id: string, graceMs = 3000): Promise<void> {
        const entry = this.services.get(requirePanelId(id));
        if (!entry) return;
        entry.stopped = true;
        entry.timedOut = false;
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
    /** An uninstalled panel: its credentials stop working and its last failure is forgotten. */
    public revokePanel(id: string): void {
        this.auth?.revokePanelTokens(requirePanelId(id));
        this.failures.delete(id);
    }
    /** Stops every service with its SIGTERM grace; one that will not stop is named and left to stopAll. */
    public async stopAllServices(graceMs = 3000): Promise<void> {
        await Promise.all([...this.services.keys()].map((id) =>
            this.stopService(id, graceMs).catch((err) => logger.error(`[services] ${id} did not stop:`, err)),
        ));
    }
    /** Synchronous last-resort exit hook: a SIGKILL, with no grace. */
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
