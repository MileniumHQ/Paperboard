import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import * as crypto from "crypto";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import { validatePanelManifest } from "./storage";
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
    /** the service said it has nothing to do until something calls it */
    idle: boolean;
    /** when it last became ready, was called, or answered */
    lastActivity: number;
    sleepTimer?: ReturnType<typeof setTimeout>;
    /** it is being stopped because it was idle, not because someone stopped it */
    sleeping?: boolean;
}

/** How long an idle service is left running after its last call. */
export const SERVICE_SLEEP_AFTER_MS = 2 * 60_000;

/**
 * What the manager asks of whoever holds what services registered (ws.ts,
 * for the Actions and Blocks registries), so a sleeping service's actions
 * stay listed and a call still waiting keeps it awake.
 */
export interface SleepHooks {
    /** a call to the panel's service is still waiting for its answer */
    busy(panelId: string): boolean;
    /** the service is about to be stopped for being idle: remember what it registered */
    beforeSleep(panelId: string): void;
    /**
     * the service's process has exited: resolves once its connections are
     * closed too, so the service started next can register the same names
     */
    released(panelId: string): Promise<void>;
    /** the service is running again, or gone for another reason: what was remembered is stale */
    forget(panelId: string): void;
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
    // who hears about services starting, getting ready, exiting and failing
    // (the traffic monitor); empty unless someone is watching
    private lifecycleListeners = new Set<(change: MonitorLifecycle) => void>();
    // Services stopped for being idle. A service with nothing to do until it
    // is called (it says so, see definePanelService's setIdle) costs a whole
    // runtime to keep around, so it is stopped and the next call to it
    // starts it again (wake). One that never says it is idle is never
    // stopped this way.
    private asleep = new Set<string>();
    private wakes = new Map<string, Promise<void>>();
    private sleeps = new Map<string, Promise<void>>();
    private sleepHooks: SleepHooks | null = null;
    private readonly sleepAfterMs: number;
    private readonly sleepAllowed: boolean;
    /**
     * `sleep: false` never puts a service to sleep. A daemon without
     * authentication hands a panel's pages the same credential as its
     * service, so it cannot tell the service's connection from a page's.
     */
    constructor(private baseDir = getPaperboardDir(), options: { sleepAfterMs?: number; sleep?: boolean } = {}) {
        this.sleepAfterMs = options.sleepAfterMs ?? SERVICE_SLEEP_AFTER_MS;
        this.sleepAllowed = options.sleep ?? true;
    }

    public setSleepHooks(hooks: SleepHooks | null): void { this.sleepHooks = hooks; }
    /** The panel's service is asleep, or being put to sleep. */
    public isAsleep(panelId: string): boolean { return this.asleep.has(panelId); }
    /** Panels whose service is asleep. */
    public sleepingPanels(): string[] { return [...this.asleep]; }

    /** Something called the panel's service, or it answered: it stays up a while longer. */
    public noteActivity(panelId: string): void {
        const entry = this.services.get(panelId);
        if (!entry) return;
        entry.lastActivity = Date.now();
        this.considerSleep(panelId, entry);
    }

    private considerSleep(id: string, entry: RunningService): void {
        clearTimeout(entry.sleepTimer);
        entry.sleepTimer = undefined;
        if (!this.sleepAllowed || !entry.idle || entry.stopped || entry.state !== "ready") return;
        const wait = Math.max(0, entry.lastActivity + this.sleepAfterMs - Date.now());
        entry.sleepTimer = setTimeout(() => {
            this.sleep(id, entry).catch((err) => logger.error(`[services] ${id} could not be put to sleep`, err));
        }, wait);
        entry.sleepTimer.unref?.();
    }

    private async sleep(id: string, entry: RunningService): Promise<void> {
        if (this.services.get(id) !== entry || !entry.idle || entry.stopped || entry.state !== "ready") return;
        // a call still waiting, or a backup it is getting ready for, keeps it up
        const held = !!entry.backupPrepare || !!this.sleepHooks?.busy(id);
        if (held) entry.lastActivity = Date.now();
        if (held || Date.now() - entry.lastActivity < this.sleepAfterMs) {
            this.considerSleep(id, entry);
            return;
        }
        // asleep from here: a call that arrives while it stops waits for the
        // stop and then starts it again, instead of reaching a dying service
        this.asleep.add(id);
        entry.sleeping = true;
        this.sleepHooks?.beforeSleep(id);
        const stopping = (async () => {
            await this.halt(id);
            await this.sleepHooks?.released(id);
        })().finally(() => this.sleeps.delete(id));
        this.sleeps.set(id, stopping);
        try {
            await stopping;
        } catch (err) {
            this.asleep.delete(id);
            this.sleepHooks?.forget(id);
            throw err;
        }
        logger.info(`[services] ${id} is idle and was put to sleep; the next call starts it`);
    }

    /** Starts a sleeping service again. Resolves once it is ready; every caller waits on the one start. */
    public wake(panelId: string): Promise<void> {
        const id = requirePanelId(panelId);
        if (!this.asleep.has(id)) return Promise.resolve();
        let waking = this.wakes.get(id);
        if (!waking) {
            waking = (async () => {
                await this.sleeps.get(id);
                if (!this.asleep.has(id)) return;
                try {
                    if (!this.startService(id)) throw new Error(`Panel ${id} no longer has a service to start`);
                    await this.waitUntilReady(id);
                } catch (err) {
                    // it could not come back: it is a failed service now, not a
                    // sleeping one, and what it had registered is gone with it
                    this.asleep.delete(id);
                    this.sleepHooks?.forget(id);
                    throw err;
                }
            })().finally(() => this.wakes.delete(id));
            this.wakes.set(id, waking);
        }
        return waking;
    }

    /** Hears every service state change from now on; returns the unsubscribe. */
    public onLifecycle(listener: (change: MonitorLifecycle) => void): () => void {
        this.lifecycleListeners.add(listener);
        return () => this.lifecycleListeners.delete(listener);
    }
    private announce(panel: string, change: ServiceChange): void {
        for (const listener of this.lifecycleListeners) {
            try {
                listener({ type: "service", panel, ...change });
            } catch (err) { logger.error(`[services] lifecycle listener failed for ${panel}`, err); }
        }
    }

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
            exited: new Promise<void>((resolve) => { resolveExit = resolve; }), stopped: false, crashCount, startedAt: Date.now(),
            idle: false, lastActivity: Date.now() };
        this.services.set(id, entry);
        this.announce(id, { state: "starting", ...(child.pid !== undefined ? { pid: child.pid } : {}) });
        entry.readyTimer = setTimeout(() => {
            entry.state = "failed";
            entry.stopped = true;
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
            if (message?.type === "paperboard:service-idle") {
                if (message.panelId !== id || entry.stopped) return;
                entry.idle = message.idle === true;
                this.considerSleep(id, entry);
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
            entry.lastActivity = Date.now();
            // It has registered everything again: its sleep is over, and what
            // was kept from it is stale. Not before: a call that arrives while
            // it starts must wait for this, like the call that woke it.
            this.asleep.delete(id);
            this.sleepHooks?.forget(id);
            this.announce(id, { state: "ready", ...(child.pid !== undefined ? { pid: child.pid } : {}) });
            resolveReady();
            this.considerSleep(id, entry);
        });
        child.stdout?.on("data", (chunk: Buffer) => logger.info(`[service:${id}] ${chunk.toString("utf8").slice(0, 65536)}`));
        child.stderr?.on("data", (chunk: Buffer) => logger.warn(`[service:${id}] ${chunk.toString("utf8").slice(0, 65536)}`));
        child.on("error", (err) => {
            entry.state = "failed";
            this.announce(id, { state: "failed", error: err.message });
            rejectReady(err);
            logger.error(`[services] ${id} process error`, err);
        });
        child.once("close", (code) => {
            clearTimeout(entry.readyTimer);
            clearTimeout(entry.sleepTimer);
            this.announce(id, { state: entry.sleeping ? "asleep" : entry.stopped ? "stopped" : "exited", code });
            entry.backupPrepare?.settle(new Error(`Service ${id} exited while getting ready`));
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
    public async waitUntilReady(id: string): Promise<void> {
        const entry = this.services.get(id);
        if (entry) await entry.ready;
    }
    /** true while the service is meant to run (started and not stopped),
     * including while it waits to restart after a crash, and while it sleeps */
    public isActive(id: string): boolean {
        const entry = this.services.get(requirePanelId(id));
        return (!!entry && !entry.stopped) || this.asleep.has(id);
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
    /** Stops a service for good: one that was asleep is no longer waiting to be started. */
    public async stopService(id: string, graceMs = 3000): Promise<void> {
        // a stop that began as a sleep finishes first, so the files it guards are free
        try { await this.sleeps.get(requirePanelId(id)); }
        catch (err) { logger.debug(`[services] ${id} was not asleep after all:`, err); }
        if (this.asleep.delete(id)) this.sleepHooks?.forget(id);
        await this.halt(id, graceMs);
    }
    private async halt(id: string, graceMs = 3000): Promise<void> {
        const entry = this.services.get(requirePanelId(id));
        if (!entry) return;
        entry.stopped = true;
        entry.state = "stopping";
        clearTimeout(entry.restartTimer);
        clearTimeout(entry.readyTimer);
        clearTimeout(entry.sleepTimer);
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
            clearTimeout(entry.restartTimer); clearTimeout(entry.readyTimer); clearTimeout(entry.sleepTimer);
            entry.rejectReady(new Error("Daemon is stopping"));
            try { entry.process.kill("SIGKILL"); } catch (err) { logger.error("[services] final kill failed", err); }
        }
        this.services.clear();
        this.asleep.clear();
    }
}
export const panelServices = new PanelServicesManager();
