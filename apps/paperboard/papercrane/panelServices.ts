import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { pathToFileURL } from "url";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import { sanitizeId, unrefTimer } from "./storage";
import type { PaperCraneAuth } from "./auth";

interface RunningService {
    panelId: string;
    scriptPath: string;
    cwd: string;
    process: cp.ChildProcess;
    crashCount: number;
    lastCrashTime: number;
    stopped: boolean;
    inProcess?: boolean;
}

// The in-process boot window. The global exists ONLY between publish and
// clear — the service's bundled PaperAPI copy consumes it at module init
// (consume-once, validated, fail-closed on garbage; PaperAPI/src/boot.ts).
// Exported for the boot-window tests; the daemon never reads it back.
const SERVICE_BOOT_GLOBAL = "__PAPERBOARD_SERVICE_BOOT";

export function publishServiceBootContext(context: {
    panelId: string;
    token: string;
    port: number;
}): void {
    (globalThis as any)[SERVICE_BOOT_GLOBAL] = context;
}

export function clearServiceBootContext(): void {
    delete (globalThis as any)[SERVICE_BOOT_GLOBAL];
}

// locate an executable on PATH, preferring the built-in runtime API
function whichRuntime(name: string): string | null {
    try {
        const bunWhich = (globalThis as any).Bun?.which;
        if (typeof bunWhich === "function") {
            const found = bunWhich(name);
            if (found) return found;
        }
    } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }
    try {
        const exe = process.platform === "win32" ? `${name}.exe` : name;
        for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
            if (!dir) continue;
            const full = path.join(dir, exe);
            try {
                fs.accessSync(full, fs.constants.X_OK);
                return full;
            } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }
        }
    } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }
    return null;
}

export class PanelServicesManager {
    private services = new Map<string, RunningService>();
    private baseDir: string;
    private port: number = 45464;
    private token: string = "";
    private auth: PaperCraneAuth | null = null;
    // one live panel token per panel id (mirrors auth.issuePanelToken);
    // the master-token warning fires once per panel id
    private panelTokens = new Map<string, string>();
    private warnedMaster = new Set<string>();
    // serializes in-process service boots: the env write is process-wide,
    // so two boots must never interleave (teardown: the chain ends when
    // the last boot resolves)
    private inProcessBoot: Promise<void> = Promise.resolve();

    constructor(baseDir?: string) {
        this.baseDir = baseDir || getPaperboardDir();
    }

    public init(port: number, token?: string, auth?: PaperCraneAuth): void {
        this.port = port;
        this.token = token || "";
        if (auth) this.auth = auth;
        this.startAll();
    }

    // test seam: wire the token issuer without starting services
    public setAuth(auth: PaperCraneAuth): void {
        this.auth = auth;
    }

    // panel-scoped credential for one panel id. Empty when no issuer is
    // wired (standalone contexts) — callers fall back to the master token
    // so existing flows never break mid-migration.
    public tokenForPanel(panelId: string): string {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return "";
        const cached = this.panelTokens.get(cleanId);
        if (cached) return cached;
        if (!this.auth) return "";
        const issued = this.auth.issuePanelToken(cleanId);
        this.panelTokens.set(cleanId, issued);
        return issued;
    }

    private getPanelsDir(): string {
        return path.join(this.baseDir, "panels");
    }

    public startAll(): void {
        const panelsDir = this.getPanelsDir();
        if (!fs.existsSync(panelsDir)) return;

        try {
            const entries = fs.readdirSync(panelsDir);
            for (const entry of entries) {
                const cleanId = sanitizeId(entry);
                if (cleanId) {
                    // the manifest autostart field is honored here: explicit
                    // starts (install/restart RPC) always run, boot only
                    // starts panels that did not opt out
                    if (this.manifestOptsOutOfAutostart(cleanId)) {
                        logger.info(`[PanelServices] Skipping autostart for panel "${cleanId}" (manifest autostart: false)`);
                        continue;
                    }
                    this.startService(cleanId);
                }
            }
        } catch (err: any) {
            logger.warn("[PanelServices] Failed to scan panels for services:", err?.message || err);
        }
    }

    private manifestOptsOutOfAutostart(panelId: string): boolean {
        try {
            const raw = fs.readFileSync(
                path.join(this.getPanelsDir(), panelId, "manifest.json"),
                "utf8",
            );
            return JSON.parse(raw)?.autostart === false;
        } catch (err) {
            // unreadable manifest: startService decides (logs + returns
            // false), boot must not silently swallow the panel
            logger.debug(`[PanelServices] autostart check fell through to start for ${panelId}:`, err);
            return false;
        }
    }

    public startService(panelId: string): boolean {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return false;

        const existing = this.services.get(cleanId);
        if (existing && !existing.stopped && existing.process && !existing.process.killed) {
            return true;
        }

        const panelDir = path.join(this.getPanelsDir(), cleanId);
        const manifestPath = path.join(panelDir, "manifest.json");
        if (!fs.existsSync(manifestPath)) return false;

        let serviceRelPath: string | null = null;
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            if (manifest.service && typeof manifest.service === "string") {
                serviceRelPath = manifest.service;
            } else {
                if (fs.existsSync(path.join(panelDir, "dist", "service.js"))) {
                    serviceRelPath = "./dist/service.js";
                } else if (fs.existsSync(path.join(panelDir, "service.js"))) {
                    serviceRelPath = "./service.js";
                }
            }
        } catch (err) {
            logger.debug(`[PanelServices] unreadable manifest for ${cleanId}, no service:`, err);
            return false;
        }

        if (!serviceRelPath) return false;

        const scriptPath = path.resolve(panelDir, serviceRelPath);
        if (!fs.existsSync(scriptPath)) {
            logger.debug(`[PanelServices] Service script not found at ${scriptPath} for ${cleanId}`);
            return false;
        }

        this.spawnServiceProcess(cleanId, scriptPath, panelDir);
        return true;
    }

    private spawnServiceProcess(panelId: string, scriptPath: string, panelDir: string): void {
        const running = this.services.get(panelId);
        const crashCount = running?.crashCount ?? 0;

        // scoped credential first: services authenticate as their panel id.
        // The master PAPERCRANE_TOKEN stays until the registry-opening
        // enforcement gate — its presence is deprecated, loud, and dated.
        const panelToken = this.tokenForPanel(panelId);
        if (this.token && !this.warnedMaster.has(panelId)) {
            this.warnedMaster.add(panelId);
            logger.warn(
                `[PanelServices] panel "${panelId}" still receives the master PAPERCRANE_TOKEN. ` +
                `Migrate to PAPERCRANE_PANEL_TOKEN (scoped to this panel). ` +
                `TODO(deny after v3.2): master-token service auth is denied at registry-open.`,
            );
        }
        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            PAPERBOARD_PANEL_ID: panelId,
            PAPERCRANE_PORT: String(this.port),
            PAPERCRANE_TOKEN: this.token,
            PAPERBOARD_DIR: this.baseDir,
            NODE_ENV: process.env.NODE_ENV || "production",
            ...(panelToken ? { PAPERCRANE_PANEL_TOKEN: panelToken } : {}),
        };

        const isElectron = !!(process as any).versions?.electron;
        const execBase = process.execPath
            ? path.basename(process.execPath).toLowerCase()
            : "";
        const isDevBun =
            !!(process as any).versions?.bun &&
            (execBase === "bun" ||
                execBase === "bun.exe" ||
                execBase.startsWith("bun-"));

        let cmd = process.execPath;
        let args = [scriptPath];

        if (isElectron) {
            env.ELECTRON_RUN_AS_NODE = "1";
        } else if (isDevBun) {
            cmd = "bun";
            args = ["run", scriptPath];
        } else {
            // standalone host may lack a runtime, resolve one
            const bunOnPath = whichRuntime("bun");
            if (bunOnPath) {
                cmd = bunOnPath;
                args = ["run", scriptPath];
            } else {
                const nodeOnPath = whichRuntime("node");
                if (nodeOnPath) {
                    // self-contained bundles run under plain node
                    cmd = nodeOnPath;
                    args = [scriptPath];
                } else {
                    // last resort: run in-process
                    void this.startServiceInProcess(
                        panelId,
                        scriptPath,
                        panelDir,
                        env,
                        crashCount,
                    );
                    return;
                }
            }
        }

        logger.info(`[PanelServices] Starting background service for panel "${panelId}" (${scriptPath})`);

        try {
            const child = cp.spawn(cmd, args, {
                cwd: panelDir,
                env,
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });

            const serviceEntry: RunningService = {
                panelId,
                scriptPath,
                cwd: panelDir,
                process: child,
                crashCount,
                lastCrashTime: Date.now(),
                stopped: false,
            };

            this.services.set(panelId, serviceEntry);

            child.stdout?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8").trim();
                if (text) logger.info(`[PanelService:${panelId}] ${text}`);
            });

            child.stderr?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8").trim();
                if (text) logger.warn(`[PanelService:${panelId}] ${text}`);
            });

            child.on("error", (err: Error) => {
                logger.error(
                    `[PanelService:${panelId}] Process spawn failed: ${err?.message} (command: ${cmd})`,
                );
            });

            child.on("close", (code: number | null) => {
                const current = this.services.get(panelId);
                if (!current || current.stopped) return;

                logger.warn(`[PanelService:${panelId}] Service process exited with code ${code}`);

                const now = Date.now();
                const timeSinceLastCrash = now - current.lastCrashTime;
                let nextCrashCount = timeSinceLastCrash < 30_000 ? current.crashCount + 1 : 1;

                if (nextCrashCount > 5) {
                    logger.error(`[PanelService:${panelId}] Service crashed too many times, suspending restart`);
                    return;
                }

                current.crashCount = nextCrashCount;
                current.lastCrashTime = now;

                const delay = Math.min(10_000, 1000 * Math.pow(2, nextCrashCount - 1));
                // backoff respawn never holds the daemon open on its own;
                // the stopped-flag check inside is the teardown path
                const respawnTimer = setTimeout(() => {
                    if (this.services.get(panelId)?.stopped) return;
                    this.spawnServiceProcess(panelId, scriptPath, panelDir);
                }, delay);
                unrefTimer(respawnTimer);
            });
        } catch (err: any) {
            logger.error(`[PanelServices] Failed to launch service for ${panelId}:`, err);
        }
    }

    // in-process host when no runtime exists, no crash isolation.
    // Credentials are NOT ambient: the boot context is published on a
    // global that exists ONLY for the duration of the import — the bundled
    // PaperAPI copy inside the service module consumes it at module init
    // and owns those credentials for the service's lifetime (see
    // PaperAPI/src/boot.ts). Concurrent in-process boots are serialized so
    // the publish window is exclusive; one panel's identity can never
    // bleed into another's, and process.env is never touched.
    private async startServiceInProcess(
        panelId: string,
        scriptPath: string,
        panelDir: string,
        env: Record<string, string>,
        crashCount: number,
    ): Promise<void> {
        logger.info(
            `[PanelServices] No bun/node runtime found — starting background service for panel "${panelId}" in-process`,
        );
        const previous = this.inProcessBoot;
        const runningInProcess = [...this.services.values()].filter((s) => s.inProcess && !s.stopped);
        if (runningInProcess.length > 0) {
            logger.warn(
                `[PanelServices] ${runningInProcess.length} in-process service(s) already running ` +
                `(${runningInProcess.map((s) => s.panelId).join(", ").slice(0, 500)}): starting "${panelId}" ` +
                `in-process shares NO crash isolation; boot contexts are per-service, but the process is shared`,
            );
        }
        const boot = previous
            .catch((err: unknown) =>
                logger.debug("[panelServices.ts] previous in-process boot failed:", err))
            .then(async () => {
                this.startModuleWithEnv(panelId, scriptPath, panelDir, env, crashCount);
            });
        this.inProcessBoot = boot;
        try {
            await boot;
        } finally {
            if (this.inProcessBoot === boot) this.inProcessBoot = Promise.resolve();
        }
    }

    private async startModuleWithEnv(
        panelId: string,
        scriptPath: string,
        panelDir: string,
        env: Record<string, string>,
        crashCount: number,
    ): Promise<void> {
        // publish the boot context for the import window: the service's
        // bundled PaperAPI copy consumes it at module init (consume-once,
        // validated, fail-closed on garbage). Same facts the spawned env
        // carries — scoped token preferred, master only as the deprecated
        // fallback the spawn path already warns about.
        publishServiceBootContext({
            panelId,
            token: env.PAPERCRANE_PANEL_TOKEN || env.PAPERCRANE_TOKEN || "",
            port: Number(env.PAPERCRANE_PORT) || 0,
        });
        try {
            await import(pathToFileURL(scriptPath).href);
        } catch (err: any) {
            logger.error(
                `[PanelServices] In-process service for panel "${panelId}" failed: ${err?.message || err}`,
            );
        } finally {
            clearServiceBootContext();
        }
        this.services.set(panelId, {
            panelId,
            scriptPath,
            cwd: panelDir,
            process: {
                // In-process services share our process: there is no stop
                // signal and no onStop hook, so stopService can only drop
                // the record. Module timers/sockets keep running until
                // process exit. If that ever matters, the fix is a real
                // teardown protocol, not a louder stub.
                kill() {
                    /* no external process to signal */
                },
                killed: false,
            } as unknown as cp.ChildProcess,
            crashCount,
            lastCrashTime: Date.now(),
            stopped: false,
            inProcess: true,
        });
        logger.info(`[PanelServices] In-process service for panel "${panelId}" is running`);
    }

    public stopService(panelId: string): void {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return;

        const running = this.services.get(cleanId);
        if (!running) return;

        running.stopped = true;
        try {
            running.process.kill("SIGTERM");
            // escalation never holds the daemon open; the killed-flag check
            // inside is the teardown path
            const killTimer = setTimeout(() => {
                try {
                    if (!running.process.killed) {
                        running.process.kill("SIGKILL");
                    }
                } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }
            }, 3000);
            unrefTimer(killTimer);
        } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }

        this.services.delete(cleanId);
        if (running.inProcess) {
            // the in-process stub above has no stop signal: module
            // timers/sockets keep running until process exit. Say exactly
            // that — "stopped" would be a lie the operator believes.
            logger.info(
                `[PanelServices] Detached in-process service for "${cleanId}" (module keeps running until process exit; no stop signal exists)`,
            );
        } else {
            logger.info(`[PanelServices] Stopped background service for "${cleanId}"`);
        }
    }

    // full panel teardown credential-side: drops the cached scoped token
    // and revokes every vault token carrying the panel's claim. Called on
    // uninstall so a removed panel stops authenticating immediately.
    public revokePanel(panelId: string): void {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return;
        this.panelTokens.delete(cleanId);
        if (this.auth) {
            const revoked = this.auth.revokePanelTokens(cleanId);
            if (revoked > 0) {
                logger.info(
                    `[PanelServices] Revoked ${revoked} scoped token(s) for uninstalled panel "${cleanId}"`,
                );
            }
        }
    }

    public restartService(panelId: string): void {
        this.stopService(panelId);
        const restartTimer = setTimeout(() => this.startService(panelId), 500);
        unrefTimer(restartTimer);
    }

    public stopAll(): void {
        for (const service of this.services.values()) {
            service.stopped = true;
            try {
                service.process.kill("SIGKILL");
            } catch (err) { logger.debug("[panelServices.ts] op failed:", err) }
        }
        this.services.clear();
    }
}

export const panelServices = new PanelServicesManager();
