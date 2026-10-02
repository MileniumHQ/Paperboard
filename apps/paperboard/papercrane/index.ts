import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const promisifiedExecFile = promisify(execFile);
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "./engine";
import { PaperCraneAuth } from "./auth";
import { handleHttpRequest } from "./http";
import { DavSessionStore } from "./dav";
import { setupWebSocketServer } from "./ws";
import { PaperCraneTui } from "./tui";
import { ensureNativeHelpersExecutable } from "./pty";
import { advertisePaperCrane, isLoopbackHost, type AdvertisementHandle } from "./discovery";
import { writeFileAtomicSync } from "./storage";
import { getDisplayHost, getLinuxDistroInfo } from "./util";
import { getLocalDir, getPaperboardDir } from "./paths";
import { loadOrCreateTlsIdentity, type TlsIdentity } from "./tlsIdentity";
import { logger } from "./logger";
import { PanelServicesManager } from "./panelServices";

export * from "./types";
export * from "./engine";
export * from "./auth";
export * from "./pty";
export * from "./http";
export * from "./ws";
export * from "./tui";
export * from "./supervisor";
export * from "./actions";
export * from "./dav";
export * from "./panelServices";
export * from "./panelAssets";
export {
    getDisplayHost,
    getNetworkIp,
    isUnspecifiedHost,
    selectNetworkIp,
} from "./util";

// build number to friendly release. The reg query runs on the WS auth
// path, so the DisplayVersion result is cached per build — one entry,
// never a growing map; a sick box pays the 5s timeout at most once.
// ASYNC: the reg child never blocks the event loop (execFile, not
// execFileSync); concurrent calls share one cached promise per build.
const windowsReleaseCache = {
    build: -1,
    name: "",
    pending: null as Promise<string> | null,
};
export async function windowsReleaseName(build: number): Promise<string> {
    if (windowsReleaseCache.build === build) return windowsReleaseCache.name;
    if (!windowsReleaseCache.pending) {
        windowsReleaseCache.pending = queryWindowsReleaseName(build)
            .then((name) => {
                windowsReleaseCache.build = build;
                windowsReleaseCache.name = name;
                return name;
            })
            .finally(() => {
                windowsReleaseCache.pending = null;
            });
    }
    return windowsReleaseCache.pending;
}

async function queryWindowsReleaseName(build: number): Promise<string> {
    if (process.platform === "win32") {
        try {
            const out = await promisifiedExecFile(
                "reg",
                [
                    "query",
                    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
                    "/v",
                    "DisplayVersion",
                ],
                { timeout: 5000 },
            );
            const m = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(out.stdout);
            if (m) {
                return `${build >= 22000 ? "11" : "10"} ${m[1]}`;
            }
        } catch (err) { logger.debug("[index.ts] op failed:", err) }
    }
    return build >= 22000 ? "11" : "10";
}

export async function getDetailedOsInfo(): Promise<{
    os: string;
    osVersion: string;
    distroId?: string;
    distroName?: string;
}> {
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
        return {
            os: "windows",
            osVersion: await windowsReleaseName(build),
            distroId: "windows",
            distroName: "Windows",
        };
    }
    if (platform === "linux") {
        const info = getLinuxDistroInfo();
        return {
            os: "linux",
            osVersion: info.version || os.release(),
            distroId: info.distroId,
            distroName: info.distroName,
        };
    }
    return {
        os: process.platform,
        osVersion: os.release(),
    };
}

export const DEFAULT_PORT =
    Number(process.env.PAPERCRANE_PORT) || 45464;
// bind all interfaces by default — running remotely is PaperCrane's job.
// every RPC still requires a token, and a non-loopback bind is TLS only.
export const DEFAULT_HOST = process.env.PAPERCRANE_HOST || "0.0.0.0";

// PID file, detects stale instances on restart. Identity is path-bound:
// only a PID whose executable matches the recorded one may be signalled.
function getPidFile(): string {
    return path.join(getPaperboardDir(), "papercrane.pid");
}

interface PidFileRecord {
    pid: number;
    startedAt: string;
    execPath: string;
}

function writePidFile() {
    try {
        const pidFile = getPidFile();
        if (!fs.existsSync(path.dirname(pidFile))) {
            fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        }
        const record: PidFileRecord = {
            pid: process.pid,
            startedAt: new Date().toISOString(),
            execPath: process.execPath,
        };
        writeFileAtomicSync(pidFile, JSON.stringify(record, null, 2));
    } catch (err) {
        logger.debug("[Paperboard Server] failed to write PID file:", err);
    }
}

function readPidRecord(): PidFileRecord | null {
    try {
        const pidFile = getPidFile();
        if (fs.existsSync(pidFile)) {
            const raw = JSON.parse(fs.readFileSync(pidFile, "utf8").trim());
            if (typeof raw?.pid === "number" && typeof raw?.execPath === "string") {
                return raw as PidFileRecord;
            }
        }
    } catch (err) {
        logger.debug("[Paperboard Server] failed to read PID file:", err);
    }
    return null;
}

function removePidFile() {
    try {
        fs.unlinkSync(getPidFile());
    } catch {
        logger.debug("[Paperboard Server] failed to remove PID file (already gone?)");
    }
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // ESRCH/EPERM both mean "not ours to signal" — false IS the answer,
        // logged so a stale-pidfile takeover stays visible
        logger.debug(`[Paperboard Server] pid ${pid} liveness probe failed (treated as not alive):`, err);
        return false;
    }
}

// verify the recorded executable path matches the running PID before
// killing it — /proc/exe on Linux, exact path compare elsewhere
function isRecordedProcessAlive(record: PidFileRecord): boolean {
    if (!isProcessAlive(record.pid)) return false;
    try {
        if (process.platform === "linux") {
            const exe = fs.readlinkSync(`/proc/${record.pid}/exe`);
            return path.resolve(exe) === path.resolve(record.execPath);
        }
        return true; // non-linux: recorded pid from our own pidfile is trusted
    } catch (err) {
        logger.debug(
            `[Paperboard Server] could not verify executable of PID ${record.pid}:`,
            err,
        );
        return false;
    }
}

async function killStalePaperCrane(
    port: number,
    _host: string, // informational; takeover is pid-file based
): Promise<boolean> {
    // PID-file reclaim only: one fact, one source, path-verified
    const record = readPidRecord();
    if (record && record.pid !== process.pid && isRecordedProcessAlive(record)) {
        console.log(
            `[Paperboard Server] Reclaiming port ${port} from stale instance (PID ${record.pid})...`,
        );
        try {
            process.kill(record.pid, "SIGTERM");
        } catch (err) {
            logger.debug(`[Paperboard Server] SIGTERM to PID ${record.pid} failed:`, err);
        }
        await new Promise((r) => setTimeout(r, 400));
        if (isProcessAlive(record.pid)) {
            try {
                process.kill(record.pid, "SIGKILL");
            } catch (err) {
                logger.debug(
                    `[Paperboard Server] SIGKILL to PID ${record.pid} failed:`,
                    err,
                );
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        removePidFile();
        return true;
    }

    // no takeable stale record: either nothing is running or the port is
    // held by something we cannot identify — never signal untrusted PIDs
    return false;
}

export interface ServerOptions {
    port?: number;
    host?: string;
    noAuth?: boolean;
    headless?: boolean;
    startPairing?: boolean;
    // Provision a single known token, pairing stays disabled
    staticToken?: string;
    // Path to the paired-computers registry enabling remote tunnels
    remotesFile?: string;
    // mDNS announcement on non-loopback binds (default on)
    advertise?: boolean;
}

// handshake file for local clients, written on every listen
function writeCraneJson(port: number, token: string | null) {
    try {
        const file = path.join(getPaperboardDir(), "local", "crane.json");
        if (!fs.existsSync(path.dirname(file)))
            fs.mkdirSync(path.dirname(file), { recursive: true });
        writeFileAtomicSync(
            file,
            JSON.stringify({ port, token }, null, 2),
            { mode: 0o600 },
        );
    } catch (err) {
        logger.warn(
            "[Paperboard Server] failed to write crane.json handshake file:",
            err,
        );
    }
}

export interface ServerInstance {
    server: http.Server | https.Server;
    wss: WebSocketServer;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    port: number;
    // plaintext loopback port for this machine's own clients (crane.json,
    // panel services). Equals port when the daemon is loopback-only.
    localPort: number;
    host: string;
    stop: () => void;
}

export function startPaperCraneServer(
    options: ServerOptions = {},
): Promise<ServerInstance> {
    return new Promise((resolve, reject) => {
        ensureNativeHelpersExecutable();
        // malformed requests must never kill the daemon wordlessly
        const g = globalThis as any;
        if (!g.__papercraneRejectionGuard) {
            g.__papercraneRejectionGuard = true;
            process.on("unhandledRejection", (reason: any) => {
                try {
                    logger.error(
                        "[Paperboard Server] unhandled rejection (daemon stays up):",
                        reason?.stack || reason?.message || reason,
                    );
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
            });
        }
        const initialPort = options.port ?? DEFAULT_PORT;
        const host = options.host ?? DEFAULT_HOST;
        const noAuth = options.noAuth ?? false;
        const headless = options.headless ?? false;
        const staticToken =
            options.staticToken ?? (noAuth ? null : crypto.randomBytes(24).toString("hex"));

        // Reachable from other computers = TLS with this computer's pinned
        // identity. Plaintext exists only on loopback, for local clients.
        const loopbackOnly = isLoopbackHost(host);
        if (noAuth && !loopbackOnly) {
            reject(new Error(`--no-auth only runs on a loopback host, not ${host}`));
            return;
        }
        let tlsIdentity: TlsIdentity | null = null;
        if (!loopbackOnly) {
            try {
                tlsIdentity = loadOrCreateTlsIdentity(getLocalDir());
            } catch (err) {
                reject(err);
                return;
            }
        }

        const tryStart = (currentPort: number) => {
            let advertisement: AdvertisementHandle | null = null;
            const panelServices = new PanelServicesManager(getPaperboardDir());
            const engine = new PaperCraneEngine(undefined, panelServices);
            const auth = new PaperCraneAuth(noAuth, undefined, undefined);
            const sessions = new DavSessionStore();
            if (staticToken && !noAuth) auth.injectToken(staticToken, "host");

            engine.recoverRunningSupervisors().catch((err) => {
                console.error(
                    "[Paperboard Server] Failed to recover running supervisors:",
                    err,
                );
            });

            const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
                handleHttpRequest(engine, req, res, { auth, sessions });
            };
            const server = tlsIdentity
                ? https.createServer({ key: tlsIdentity.key, cert: tlsIdentity.cert }, onRequest)
                : http.createServer(onRequest);
            const localServer = tlsIdentity ? http.createServer(onRequest) : null;

            const wss = new WebSocketServer({ noServer: true });
            for (const listener of [server, localServer]) {
                listener?.on("upgrade", (req, socket, head) => {
                    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
                });
            }
            setupWebSocketServer(wss, engine, auth, {
                remotesFile: options.remotesFile,
                staticToken,
            });

            const stop = () => {
                try {
                    auth.flushTokenStore();
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
                try {
                    auth.dispose();
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
                try {
                    panelServices.stopAll();
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
                try {
                    advertisement?.stop();
                    advertisement = null;
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
                try {
                    void engine.disposeClients(3000).catch((err) =>
                        logger.debug("[index.ts] dispose clients failed:", err),
                    );
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
                try {
                    // ws 8 leaves connected sockets open on close(); a
                    // stopped daemon must not keep serving them
                    for (const client of wss.clients) client.close(1001, "Paperboard Server stopped");
                    wss.close();
                    localServer?.close();
                    server.close(() => {
                        if (!noAuth && !headless) {
                            process.exit(0);
                        }
                    });
                } catch (err) { logger.debug("[index.ts] op failed:", err) }
            };

            // handle sync and async bind errors through one handler
            let listenFailed = false;
            let hasListened = false;
            const handleListenError = async (err: any) => {
                // post-listen socket errors never tear down the server
                if (hasListened) {
                    logger.debug("[Paperboard Server] server socket error after listen:", err?.message ?? err);
                    return;
                }
                if (listenFailed) return;
                listenFailed = true;
                try {
                    wss.close();
                    localServer?.close();
                    server.close();
                } catch (err) { logger.debug("[index.ts] op failed:", err) }

                const msg = err?.message || "";
                const inUse =
                    err?.code === "EADDRINUSE" || /already in use|in use/i.test(msg);
                if (inUse) {
                    const killed = await killStalePaperCrane(currentPort, host);
                    if (killed) {
                        tryStart(currentPort);
                        return;
                    }
                    // Port is held by a foreign, non-PaperCrane application
                    const friendly =
                        `[Paperboard Server] Port ${currentPort} is already in use by another application.\n` +
                        `  Run with --port <number> to choose a different port, or free up port ${currentPort} first.`;
                    console.error(friendly);
                    reject(new Error(friendly));
                } else {
                    reject(err);
                }
            };
            server.on("error", (err: any) => {
                void handleListenError(err);
            });
            // ws re-emits bind errors, so handle them here too
            wss.on("error", (err: any) => {
                void handleListenError(err);
            });

            const onListening = () => {
                const addr = server.address();
                const actualPort =
                    typeof addr === "object" && addr ? addr.port : currentPort;
                if (!localServer) {
                    onReady(actualPort, actualPort);
                    return;
                }
                localServer.once("error", (err) => void handleListenError(err));
                localServer.listen(0, "127.0.0.1", () => {
                    const local = localServer.address();
                    onReady(actualPort, typeof local === "object" && local ? local.port : 0);
                });
            };

            const onReady = (actualPort: number, localPort: number) => {
                hasListened = true;

                // children must never outlive the daemon
                process.once("exit", () => {
                    auth.flushTokenStore();
                    panelServices.stopAll();
                    engine.killAllClients();
                });
                process.once("SIGTERM", () => {
                    panelServices.stopAll();
                    engine.killAllClients();
                    try {
                        advertisement?.stop();
                    } catch (err) { logger.debug("[index.ts] op failed:", err) }
                    removePidFile();
                    process.exit(0);
                });
                process.once("SIGINT", () => {
                    panelServices.stopAll();
                    engine.killAllClients();
                    try {
                        advertisement?.stop();
                    } catch (err) { logger.debug("[index.ts] op failed:", err) }
                    removePidFile();
                    process.exit(0);
                });

                // Start background services for installed panels
                try {
                    panelServices.init(localPort, staticToken ?? undefined, auth);
                } catch (err: any) {
                    logger.warn("[Paperboard Server] Failed to initialize panel services:", err?.message || err);
                }

                // this instance owns the port now: safe to sweep interrupted
                // artifacts (never before — see sweepStartupOrphans)
                engine.sweepStartupOrphans();

                // only standalone daemons claim the PID file
                writeCraneJson(localPort, staticToken);

                // announce over mDNS (loopback skips inside)
                if (options.advertise !== false) {
                    advertisement = advertisePaperCrane({
                        port: actualPort,
                        host,
                    });
                }

                if (!headless) {
                    writePidFile();
                }

                // LAN pairing may need a firewall exception on Windows
                if (process.platform === "win32") {
                    logger.info(
                        "[Paperboard Server] LAN pairing needs a Windows Firewall inbound exception for this binary. Accept the first-listen prompt, or add one manually (Defender Firewall > Allow an app > papercrane). Declined/missing = remote HTTP/WS times out while loopback works.",
                    );
                }

                if (noAuth || headless) {
                    console.log(
                        `[Paperboard Server] Listening on ${tlsIdentity ? "https" : "http"}://${getDisplayHost(host)}:${actualPort}`,
                    );
                } else {
                    // pairing opens only when asked: [p] in the TUI, or
                    // --start-pairing at launch. A daemon listening on the
                    // LAN never offers a pairing code on its own.
                    if (options.startPairing) {
                        auth.startPairing();
                    }

                    const tui = new PaperCraneTui({
                        host,
                        port: actualPort,
                        secure: tlsIdentity !== null,
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
                    localPort,
                    host,
                    stop,
                });
            };

            try {
                server.listen(currentPort, host, onListening);
            } catch (err) {
                void handleListenError(err);
            }
        };

        tryStart(initialPort);
    });
}

import { Command } from "commander";

export function parseCliArgs(argv: string[] = process.argv): ServerOptions & { supervise?: string; panelService?: string } {
    const program = new Command();
    program
        .name("papercrane")
        .allowUnknownOption(false)
        .option("--no-auth", "disable authentication")
        .option("--local", "alias for --no-auth")
        .option("--headless", "run without TUI/pairing UI")
        .option("--start-pairing", "show a pairing code at launch (otherwise press p)")
        .option("--port <number>", "listen port", (v) => Number(v))
        .option("--host <host>", "listen host")
        .option("--allow-registry-override", "honor ORIGAMI_REGISTRY_URL even in production")
        .option("--supervise <procId>", "run as supervisor for procId")
        .option("--panel-service <path>", "run a panel's service module (internal)");
    program.parse(argv);
    const opts = program.opts();
    const options: ServerOptions & { supervise?: string; panelService?: string } = {};
    // --no-auth surfaces as opts.auth === false, check both spellings
    if (opts.auth === false || opts.noAuth || opts.local) options.noAuth = true;
    if (opts.headless) options.headless = true;
    if (opts.startPairing) options.startPairing = true;
    if (typeof opts.port === "number" && Number.isFinite(opts.port)) {
        options.port = opts.port;
    }
    if (typeof opts.host === "string" && opts.host) options.host = opts.host;
    if (typeof opts.supervise === "string" && opts.supervise) {
        (options as any).supervise = opts.supervise;
    }
    if (typeof opts.panelService === "string" && opts.panelService) {
        options.panelService = opts.panelService;
    }
    return options;
}
// Entry lives in ./main.ts (import.meta.main gate): importing this module
// — from Electron, from tests, from anywhere — never autostarts a server.
// The old main-module detection heuristic died with the split, and the
// comment states that without quoting the removed code.
