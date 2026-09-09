import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { pathToFileURL } from "url";
import { logger } from "./logger";
import { getPaperboardDir } from "./paths";
import { sanitizeId } from "./storage";

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

// locate an executable on PATH, preferring the built-in runtime API
function whichRuntime(name: string): string | null {
    try {
        const bunWhich = (globalThis as any).Bun?.which;
        if (typeof bunWhich === "function") {
            const found = bunWhich(name);
            if (found) return found;
        }
    } catch {}
    try {
        const exe = process.platform === "win32" ? `${name}.exe` : name;
        for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
            if (!dir) continue;
            const full = path.join(dir, exe);
            try {
                fs.accessSync(full, fs.constants.X_OK);
                return full;
            } catch {}
        }
    } catch {}
    return null;
}

export class PanelServicesManager {
    private services = new Map<string, RunningService>();
    private baseDir: string;
    private port: number = 45464;
    private token: string = "";

    constructor(baseDir?: string) {
        this.baseDir = baseDir || getPaperboardDir();
    }

    public init(port: number, token?: string): void {
        this.port = port;
        this.token = token || "";
        this.startAll();
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
                    this.startService(cleanId);
                }
            }
        } catch (err: any) {
            logger.warn("[PanelServices] Failed to scan panels for services:", err?.message || err);
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
        } catch {
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

        const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            PAPERBOARD_PANEL_ID: panelId,
            PAPERCRANE_PORT: String(this.port),
            PAPERCRANE_TOKEN: this.token,
            PAPERBOARD_DIR: this.baseDir,
            NODE_ENV: process.env.NODE_ENV || "production",
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
                setTimeout(() => {
                    if (this.services.get(panelId)?.stopped) return;
                    this.spawnServiceProcess(panelId, scriptPath, panelDir);
                }, delay);
            });
        } catch (err: any) {
            logger.error(`[PanelServices] Failed to launch service for ${panelId}:`, err);
        }
    }

    // in-process host when no runtime exists, no crash isolation
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
        try {
            for (const [k, v] of Object.entries(env)) {
                if (v !== undefined) process.env[k] = v;
            }
            process.env.PAPERBOARD_PANEL_ID = panelId;
            await import(pathToFileURL(scriptPath).href);
            this.services.set(panelId, {
                panelId,
                scriptPath,
                cwd: panelDir,
                process: {
                    kill() {},
                    killed: false,
                } as unknown as cp.ChildProcess,
                crashCount,
                lastCrashTime: Date.now(),
                stopped: false,
                inProcess: true,
            });
            logger.info(`[PanelServices] In-process service for panel "${panelId}" is running`);
        } catch (err: any) {
            logger.error(
                `[PanelServices] In-process service for panel "${panelId}" failed: ${err?.message || err}`,
            );
        }
    }

    public stopService(panelId: string): void {
        const cleanId = sanitizeId(panelId);
        if (!cleanId) return;

        const running = this.services.get(cleanId);
        if (!running) return;

        running.stopped = true;
        try {
            running.process.kill("SIGTERM");
            setTimeout(() => {
                try {
                    if (!running.process.killed) {
                        running.process.kill("SIGKILL");
                    }
                } catch {}
            }, 3000);
        } catch {}

        this.services.delete(cleanId);
        logger.info(`[PanelServices] Stopped background service for "${cleanId}"`);
    }

    public restartService(panelId: string): void {
        this.stopService(panelId);
        setTimeout(() => this.startService(panelId), 500);
    }

    public stopAll(): void {
        for (const service of this.services.values()) {
            service.stopped = true;
            try {
                service.process.kill("SIGKILL");
            } catch {}
        }
        this.services.clear();
    }
}

export const panelServices = new PanelServicesManager();
