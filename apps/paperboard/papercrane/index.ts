import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "./engine";
import { PaperCraneAuth } from "./auth";
import { handleHttpRequest } from "./http";
import { setupWebSocketServer } from "./ws";
import { PaperCraneTui } from "./tui";
import { advertisePaperCrane, type AdvertisementHandle } from "./discovery";
import { getPaperboardDir } from "./paths";
import { logger } from "./logger";

export * from "./types";
export * from "./engine";
export * from "./auth";
export * from "./pty";
export * from "./http";
export * from "./ws";
export * from "./tui";
export * from "./supervisor";

export function getNetworkIp(): string {
    const ifaces = os.networkInterfaces();
    let fallback = "127.0.0.1";

    for (const name of Object.keys(ifaces)) {
        const list = ifaces[name];
        if (!list) continue;
        for (const item of list) {
            if (!item.internal && item.family === "IPv4") {
                if (
                    item.address.startsWith("192.168.") ||
                    item.address.startsWith("10.") ||
                    item.address.startsWith("172.")
                ) {
                    return item.address;
                }
                fallback = item.address;
            }
        }
    }

    return fallback;
}

export function getDetailedOsInfo(): {
    os: string;
    osVersion: string;
    distroId?: string;
    distroName?: string;
} {
    const platform = process.platform;
    if (platform === "darwin") {
        const darwinMajor = parseInt(os.release().split(".")[0], 10);
        const macVersion =
            !isNaN(darwinMajor) && darwinMajor >= 20
                ? (darwinMajor - 9).toString()
                : os.release();
        return {
            os: "macos",
            osVersion: macVersion,
            distroId: "macos",
            distroName: "macOS",
        };
    }
    if (platform === "win32") {
        const build = parseInt(os.release().split(".")[2] || "0", 10);
        const winVersion = build >= 22000 ? "11" : "10";
        return {
            os: "windows",
            osVersion: winVersion,
            distroId: "windows",
            distroName: "Windows",
        };
    }
    if (platform === "linux") {
        let distroId = "linux";
        let distroName = "Linux";
        let version = "";
        try {
            if (fs.existsSync("/etc/os-release")) {
                const content = fs.readFileSync("/etc/os-release", "utf8");
                const lines = content.split("\n");
                const map: Record<string, string> = {};
                for (const line of lines) {
                    const [k, ...rest] = line.split("=");
                    if (k && rest.length) {
                        map[k.trim()] = rest
                            .join("=")
                            .replace(/^["']|["']$/g, "")
                            .trim();
                    }
                }
                distroId = (map.ID || map.ID_LIKE || "linux").toLowerCase();
                distroName = map.NAME || map.PRETTY_NAME || "Linux";
                if (map.VERSION_ID) {
                    version = map.VERSION_ID;
                } else if (map.BUILD_ID) {
                    version = map.BUILD_ID;
                }
            }
        } catch (err) {
            logger.debug("[PaperCrane] failed to read /etc/os-release:", err);
        }

        if (!version) {
            version = os.release();
        }

        return {
            os: "linux",
            osVersion: version,
            distroId,
            distroName,
        };
    }
    return {
        os: process.platform,
        osVersion: os.release(),
    };
}

export const DEFAULT_PORT =
    Number(process.env.PAPERCRANE_PORT || process.env.PORT) || 45464;
// Binds all interfaces by default so fresh machines are pairable. This is
// safe post-hardening: every RPC requires a token, pairing gates control
// access, /health exposes no sensitive data, and /shutdown is
// header-guarded + localhost-only. Override with PAPERCRANE_HOST/--host.
export const DEFAULT_HOST =
    process.env.PAPERCRANE_HOST || process.env.HOST || "0.0.0.0";

// PID file path — used to detect and kill stale instances on restart
function getPidFile(): string {
    return path.join(getPaperboardDir(), "papercrane.pid");
}

function writePidFile() {
    try {
        const pidFile = getPidFile();
        if (!fs.existsSync(path.dirname(pidFile))) {
            fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        }
        fs.writeFileSync(pidFile, String(process.pid), "utf8");
    } catch (err) {
        logger.debug("[PaperCrane] failed to write PID file:", err);
    }
}

function readPidFile(): number | null {
    try {
        const pidFile = getPidFile();
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
            return isNaN(pid) ? null : pid;
        }
    } catch (err) {
        logger.debug("[PaperCrane] failed to read PID file:", err);
    }
    return null;
}

function removePidFile() {
    try {
        fs.unlinkSync(getPidFile());
    } catch {}
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// Best-effort identity check before killing a PID reported by the network:
// verifies the process command line actually looks like PaperCrane. Prevents
// a spoofed health response from making us SIGKILL an unrelated process.
function isLikelyPaperCrane(pid: number): boolean {
    try {
        if (process.platform === "linux") {
            const cmdline = fs
                .readFileSync(`/proc/${pid}/cmdline`, "utf8")
                .replace(/\0/g, " ");
            return /papercrane|paperboard/i.test(cmdline);
        }
        if (process.platform === "darwin") {
            const out = require("child_process")
                .execSync(`ps -p ${pid} -o command=`, { encoding: "utf8" })
                .trim();
            return /papercrane|paperboard/i.test(out);
        }
        if (process.platform === "win32") {
            const out = require("child_process")
                .execSync(
                    `powershell.exe -NoProfile -Command "(Get-Process -Id ${pid}).Path"`,
                    { encoding: "utf8", timeout: 5000 },
                )
                .trim()
                .toLowerCase();
            return out.includes("papercrane") || out.includes("paperboard");
        }
    } catch (err) {
        logger.debug(
            `[PaperCrane] could not verify identity of PID ${pid}:`,
            err,
        );
    }
    // Unverifiable — refuse to kill on identity alone
    return false;
}

async function killStalePaperCrane(
    port: number,
    host: string,
): Promise<boolean> {
    // Strategy 1: PID file — instant kill, no network needed.
    // The PID file is only written by standalone daemons, but verify the
    // process identity anyway in case the file is stale or corrupt.
    const stalePid = readPidFile();
    if (stalePid && stalePid !== process.pid && isProcessAlive(stalePid)) {
        if (!isLikelyPaperCrane(stalePid)) {
            console.warn(
                `[PaperCrane] PID ${stalePid} in pidfile is not PaperCrane — refusing to kill.`,
            );
            removePidFile();
            return false;
        }
        console.log(
            `[PaperCrane] Killing stale instance (PID ${stalePid}) to reclaim port ${port}...`,
        );
        try {
            process.kill(stalePid, "SIGTERM");
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
        if (isProcessAlive(stalePid)) {
            try {
                process.kill(stalePid, "SIGKILL");
            } catch {}
            await new Promise((r) => setTimeout(r, 200));
        }
        removePidFile();
        return true;
    }

    // Strategy 2: HTTP health probe — handles instances started without a PID file
    try {
        const checkHost =
            host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
        const healthRes = await fetch(`http://${checkHost}:${port}/health`, {
            signal: AbortSignal.timeout(1500),
        }).catch(() => null);

        if (healthRes?.ok) {
            const data = (await healthRes
                .json()
                .catch((err) => {
                    logger.debug(
                        `[PaperCrane] /health probe on port ${port} returned invalid JSON:`,
                        err,
                    );
                    return null;
                })) as { service?: string; pid?: number } | null;
            if (data && data.service === "papercrane") {
                console.log(
                    `[PaperCrane] Port ${port} occupied by PaperCrane (PID ${data.pid || "unknown"}). Replacing...`,
                );
                await fetch(`http://${checkHost}:${port}/shutdown`, {
                    method: "POST",
                    headers: { "X-PaperCrane-Shutdown": "1" },
                    signal: AbortSignal.timeout(1000),
                }).catch(() => null);
                await new Promise((r) => setTimeout(r, 600));
                const pid = data.pid;
                // Only SIGKILL as last resort, and only after verifying identity
                if (
                    typeof pid === "number" &&
                    isProcessAlive(pid) &&
                    pid !== process.pid &&
                    isLikelyPaperCrane(pid)
                ) {
                    try {
                        process.kill(pid, "SIGKILL");
                    } catch {}
                }
                await new Promise((r) => setTimeout(r, 300));
                return true;
            }
        }
    } catch (err) {
        logger.debug(
            `[PaperCrane] stale-instance health probe on port ${port} failed:`,
            err,
        );
    }

    return false;
}

export interface ServerOptions {
    port?: number;
    host?: string;
    noAuth?: boolean;
    headless?: boolean;
    startPairing?: boolean;
    // Provision a single known token (embedded/local daemon mode). The same
    // token must be presented by clients; pairing stays disabled.
    staticToken?: string;
    // Path to the paired-computers registry enabling remote:open tunnels.
    remotesFile?: string;
}

// Handshake file letting local clients (panels via bootstrap, headless
// scripts) discover the daemon. Written on every successful listen.
function writeCraneJson(port: number, token: string | null) {
    try {
        const file = path.join(getPaperboardDir(), "local", "crane.json");
        if (!fs.existsSync(path.dirname(file)))
            fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
            file,
            JSON.stringify({ port, token }, null, 2),
            "utf8",
        );
    } catch (err) {
        logger.warn(
            "[PaperCrane] failed to write crane.json handshake file:",
            err,
        );
    }
}

export interface ServerInstance {
    server: http.Server;
    wss: WebSocketServer;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    port: number;
    host: string;
    stop: () => void;
}

export function startPaperCraneServer(
    options: ServerOptions = {},
): Promise<ServerInstance> {
    return new Promise((resolve, reject) => {
        const initialPort = options.port ?? DEFAULT_PORT;
        const host = options.host ?? DEFAULT_HOST;
        const noAuth = options.noAuth ?? false;
        const headless = options.headless ?? false;
        const staticToken =
            options.staticToken ?? (noAuth ? null : crypto.randomBytes(24).toString("hex"));

        const tryStart = (currentPort: number) => {
            let advertisement: AdvertisementHandle | null = null;
            const engine = new PaperCraneEngine();
            const auth = new PaperCraneAuth(noAuth, undefined, undefined);
            if (staticToken && !noAuth) auth.injectToken(staticToken, "host");

            engine.recoverRunningSupervisors().catch((err) => {
                console.error(
                    "[PaperCrane] Failed to recover running supervisors:",
                    err,
                );
            });

            const server = http.createServer((req, res) => {
                handleHttpRequest(engine, req, res);
            });

            const wss = new WebSocketServer({ server });
            setupWebSocketServer(wss, engine, auth, {
                remotesFile: options.remotesFile,
                staticToken,
            });

            const stop = () => {
                try {
                    advertisement?.stop();
                    advertisement = null;
                } catch {}
                try {
                    void engine.disposeClients(3000).catch(() => {});
                } catch {}
                try {
                    wss.close();
                    server.close(() => {
                        if (!noAuth && !headless) {
                            process.exit(0);
                        }
                    });
                } catch {}
            };

            server.on("error", async (err: any) => {
                try {
                    wss.close();
                    server.close();
                } catch {}

                if (err.code === "EADDRINUSE") {
                    const killed = await killStalePaperCrane(currentPort, host);
                    if (killed) {
                        tryStart(currentPort);
                        return;
                    }
                    // Port is held by a foreign, non-PaperCrane application
                    const msg =
                        `[PaperCrane] Port ${currentPort} is already in use by another application.\n` +
                        `  Run with --port <number> to choose a different port, or free up port ${currentPort} first.`;
                    console.error(msg);
                    reject(new Error(msg));
                } else {
                    reject(err);
                }
            });

            server.listen(currentPort, host, () => {
                const addr = server.address();
                const actualPort =
                    typeof addr === "object" && addr ? addr.port : currentPort;

                // Supervised children must never outlive the daemon. The
                // graceful path runs via stop(); these handlers catch hard
                // exits (crashes, signals) where waiting is not an option.
                process.once("exit", () => engine.killAllClients());
                process.once("SIGTERM", () => {
                    engine.killAllClients();
                    try {
                        advertisement?.stop();
                    } catch {}
                    removePidFile();
                    process.exit(0);
                });
                process.once("SIGINT", () => {
                    engine.killAllClients();
                    try {
                        advertisement?.stop();
                    } catch {}
                    removePidFile();
                    process.exit(0);
                });

                // Only standalone daemons claim the global PID file. Embedded
                // (headless, ephemeral-port) instances must not — otherwise a
                // later standalone launch would kill the running app.
                writeCraneJson(actualPort, staticToken);

                // Announce the daemon over mDNS so Paperboard can discover it.
                // Loopback-only daemons skip this inside advertisePaperCrane.
                advertisement = advertisePaperCrane({
                    port: actualPort,
                    host,
                });

                if (!headless) {
                    writePidFile();
                }

                if (noAuth || headless) {
                    console.log(
                        `[PaperCrane] Listening on http://${host}:${actualPort}`,
                    );
                } else {
                    const existingClients = auth.getAuthorizedClients();
                    if (options.startPairing || existingClients.length === 0) {
                        auth.startPairing();
                    }

                    const tui = new PaperCraneTui({
                        host,
                        port: actualPort,
                        auth,
                        onStop: stop,
                    });

                    tui.start();
                }

                resolve({
                    server,
                    wss,
                    engine,
                    auth,
                    port: actualPort,
                    host,
                    stop,
                });
            });
        };

        tryStart(initialPort);
    });
}

function parseCliArgs(): ServerOptions {
    const args = process.argv.slice(2);
    const options: ServerOptions = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--no-auth" || arg === "--local") {
            options.noAuth = true;
        } else if (arg === "--headless") {
            options.headless = true;
        } else if (arg === "--pair") {
            options.startPairing = true;
        } else if (arg === "--port" && args[i + 1]) {
            options.port = Number(args[++i]);
        } else if (arg === "--host" && args[i + 1]) {
            options.host = args[++i];
        }
    }

    return options;
}

const superviseIdx = process.argv.indexOf("--supervise");
if (superviseIdx !== -1 && process.argv[superviseIdx + 1]) {
    const procId = process.argv[superviseIdx + 1];
    import("./supervisor").then(({ runSupervisor }) => {
        runSupervisor(procId).catch((err) => {
            console.error(`[Supervisor Error]`, err);
            process.exit(1);
        });
    });
} else if (typeof require !== "undefined" && require.main === module) {
    startPaperCraneServer(parseCliArgs()).catch((err) => {
        console.error(err);
    });
} else if (
    typeof process !== "undefined" &&
    process.argv[1]?.includes("papercrane")
) {
    startPaperCraneServer(parseCliArgs()).catch((err) => {
        console.error(err);
    });
}
