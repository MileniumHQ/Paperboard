// The daemon's servers: what one start builds (engine, auth, HTTP and
// WebSocket listeners), how it ends (daemonLifecycle), and the port retry
// that reclaims a port from this computer's own stale daemon.
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as crypto from "crypto";
import { WebSocketServer } from "ws";
import { PaperCraneEngine } from "../engine/index";
import { PaperCraneAuth } from "../security/auth";
import { handleHttpRequest } from "./http";
import { createHostAuthorityCheck } from "./hostAuthority";
import { davMaxUploadBytes } from "./dav";
import { DavSessionStore } from "./davAuth";
import { setupWebSocketServer } from "./ws";
import { PaperCraneTui } from "../cli/tui";
import { advertisePaperCrane, isLoopbackHost, type AdvertisementHandle } from "../system/discovery";
import { writeFileAtomicSync } from "../core/storage";
import { getDisplayHost } from "../core/util";
import { DEFAULT_LISTEN_PORT } from "../cli/cli";
import { getLocalDir, getPaperboardDir, ensurePrivateDir } from "../core/paths";
import {
    craneHandshakePath, removeCraneHandshake,
    DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE, isDaemonChallenge, daemonProof,
} from "../security/handshake";
import { loadOrCreateTlsIdentity, type TlsIdentity } from "../security/tlsIdentity";
import { certFingerprint } from "../security/pinnedTls";
import { logger } from "../core/logger";
import { PanelServicesManager } from "../panels/panelServices";
import { backupServiceFor } from "../rpc/backups";
import { problemsFor } from "../rpc/problems";
import { clipProblemReport } from "@mileniumhq/paperapi/problemShape";
import { readDaemonStatus } from "../cli/localControl";
import { killStalePaperCrane, removePidFile, writePidFile } from "../core/pidFile";
import { errorCode, errorMessage } from "@mileniumhq/paperapi/errors";
import { Roster } from "../network/roster";
import { NETWORK_DIR, RosterRecords } from "../network/rosterStore";
import { SharedDocuments } from "../network/shared";
import type { RecordStore } from "../network/store";
import { importPairedComputers } from "../network/importPairedComputers";

export const DEFAULT_PORT =
    Number(process.env.PAPERCRANE_PORT) || DEFAULT_LISTEN_PORT;
// bind all interfaces by default — running remotely is PaperCrane's job.
// every RPC still requires a token, and a non-loopback bind is TLS only.
export const DEFAULT_HOST = process.env.PAPERCRANE_HOST || "0.0.0.0";

export interface ServerOptions {
    port?: number;
    host?: string;
    noAuth?: boolean;
    headless?: boolean;
    startPairing?: boolean;
    // Provision a single known token, pairing stays disabled
    staticToken?: string;
    // mDNS announcement on non-loopback binds (default on)
    advertise?: boolean;
    // stop, as on SIGTERM, once the process that started the daemon is gone
    exitWithParent?: boolean;
}

export interface ServerInstance {
    server: http.Server | https.Server;
    wss: WebSocketServer;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    /** the network's record store: the computer list's records and the shared documents' */
    records: RecordStore;
    /** the computers of the network, this one among them */
    roster: Roster;
    port: number;
    // plaintext loopback port for this machine's own clients (crane.json,
    // panel services). Equals port when the daemon is loopback-only.
    localPort: number;
    host: string;
    stop: () => void;
}

// what every listen attempt of one start shares
interface DaemonConfig {
    options: ServerOptions;
    host: string;
    noAuth: boolean;
    headless: boolean;
    staticToken: string | null;
    // set off loopback: reachable from other computers = TLS with this
    // computer's pinned identity. Plaintext exists only on loopback.
    tlsIdentity: TlsIdentity | null;
    roster: Roster;
    records: RecordStore;
    // the panels' and the shell's documents every computer holds
    shared: SharedDocuments;
}

// handshake file for local clients, written on every listen. Throws: a
// daemon whose handshake was not written is unreachable to its own host,
// so startup fails instead of reporting a ready server nobody can find.
// pid and listen are for `papercrane status`, which reports the address
// other computers use (port is this computer's own loopback port)
function writeCraneJson(file: string, port: number, token: string | null, startId: string, listen: { host: string; port: number; secure: boolean }) {
    ensurePrivateDir(path.dirname(file));
    writeFileAtomicSync(
        file,
        JSON.stringify({ port, token, startId, pid: process.pid, listen }, null, 2),
        { mode: 0o600 },
    );
}

// One daemon per data directory. A second one would overwrite crane.json,
// hiding the first from every local client, and delete it on exit. Only a
// daemon that proves it holds this folder's token counts: a stale crane.json
// whose port another program now answers on owns nothing.
async function refuseRunningDaemon(): Promise<void> {
    let status: Awaited<ReturnType<typeof readDaemonStatus>>;
    try {
        status = await readDaemonStatus();
    } catch (err) {
        logger.warn(
            `[Paperboard Server] ${craneHandshakePath()} names no daemon that answers for this data directory (${errorMessage(err)}); starting a new one.`,
        );
        return;
    }
    if (!status.running) return;
    throw new Error(
        `A Paperboard server daemon is already running for ${status.dataDir}${status.pid !== undefined ? ` (PID ${status.pid})` : ""}. Stop it first, or start this one with another --data-dir.`,
    );
}

export async function startPaperCraneServer(
    options: ServerOptions = {},
): Promise<ServerInstance> {
    const host = options.host ?? DEFAULT_HOST;
    if (options.noAuth && !isLoopbackHost(host)) {
        throw new Error(`--no-auth only runs on a loopback host, not ${host}`);
    }
    await refuseRunningDaemon();

    // a rejection nobody handled must never kill the daemon wordlessly
    const g = globalThis as any;
    if (!g.__papercraneRejectionGuard) {
        g.__papercraneRejectionGuard = true;
        process.on("unhandledRejection", (reason: any) => {
            logger.error("[Paperboard Server] unhandled rejection (daemon stays up):", reason?.stack || reason?.message || reason);
        });
    }
    const noAuth = options.noAuth ?? false;
    if (noAuth) {
        console.warn("[Paperboard Server] WARNING: --no-auth disables authentication. Any local program can control this daemon and its data. Use only for development on a trusted, single-user machine.");
    }
    // every daemon has its key, loopback-only too: it is who this computer
    // is in the roster, whether or not other computers can reach it yet
    const localDir = ensurePrivateDir(getLocalDir());
    const identity = loadOrCreateTlsIdentity(localDir);
    const members = await RosterRecords.open(path.join(localDir, NETWORK_DIR), identity);
    const roster = await Roster.open(localDir, identity, members);
    try {
        // TODO(remove after v0.6): the desktop app's own list from 0.4 and before
        await importPairedComputers(localDir, roster);
    } catch (err) {
        roster.close();
        throw new Error(`The paired computers couldn't be moved into the computer list (local/paired_computers.json is kept as it was, and the next start tries again): ${errorMessage(err)}`, { cause: err });
    }
    // what this computer is now, saved before anyone asks for the list
    await roster.refreshSelfFacts().catch((err) => {
        logger.error("[Paperboard Server] this computer's OS details couldn't be read; the computer list keeps the ones it had:", err); // quiet: the roster keeps the last details it read, and the next start reads them again
    });
    const config: DaemonConfig = {
        options,
        host,
        noAuth,
        headless: options.headless ?? false,
        staticToken: options.staticToken ?? (noAuth ? null : crypto.randomBytes(24).toString("hex")),
        tlsIdentity: isLoopbackHost(host) ? null : identity,
        roster,
        records: members.records,
        shared: new SharedDocuments({ store: members.records, nameOf: (id) => roster.member(id)?.name }),
    };

    const port = options.port ?? DEFAULT_PORT;
    for (;;) {
        try {
            return await listenOnce(config, port);
        } catch (err: any) {
            const inUse = err?.code === "EADDRINUSE" || /already in use|in use/i.test(err?.message || "");
            if (inUse && (await killStalePaperCrane(port))) continue;
            // this start is over: nothing reads the roster for it
            config.shared.close();
            roster.close();
            if (!inUse) throw err;
            // Port is held by a foreign, non-PaperCrane application.
            // The caller prints it (main.ts fatalCliError) or shows it
            // (the desktop app): printing it here too said it twice
            throw Object.assign(
                new Error(
                    `Port ${port} is already in use by another application.\n` +
                    `  Run with --port <number> to choose a different port, or free up port ${port} first.`,
                ),
                { code: "EADDRINUSE", port },
            );
        }
    }
}

// The listeners of one attempt: the main server (TLS off loopback), the
// plaintext loopback server beside a TLS one, and the WebSocket server both
// upgrade into.
function createListeners(config: DaemonConfig, engine: PaperCraneEngine, auth: PaperCraneAuth) {
    const { tlsIdentity, staticToken } = config;
    const sessions = new DavSessionStore();
    const allowsHost = createHostAuthorityCheck(config.host);
    const allowsLocalHost = createHostAuthorityCheck();
    const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
        try {
            const encrypted = (req.socket as import("tls").TLSSocket).encrypted;
            handleHttpRequest(engine, req, res, {
                auth,
                sessions,
                allowsHost: tlsIdentity && !encrypted ? allowsLocalHost : allowsHost,
            });
        } catch (err) {
            logger.error(`[Paperboard Server] ${req.method} ${req.url} failed (staying up):`, err);
            try {
                if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
            } catch { res.destroy(); }
        }
    };
    const server = tlsIdentity
        ? https.createServer({ key: tlsIdentity.key, cert: tlsIdentity.cert }, onRequest)
        : http.createServer(onRequest);
    const localServer = tlsIdentity ? http.createServer(onRequest) : null;
    // An upload that waits for a go-ahead (Expect: 100-continue) and
    // declares more than the upload cap is refused before its body
    // is sent. Refused while the body is still arriving, the
    // closing connection resets on Windows and the client loses the
    // 413 for "ECONNRESET". Every other request goes on as usual.
    const onCheckContinue = (req: http.IncomingMessage, res: http.ServerResponse) => {
        const declared = Number(req.headers["content-length"]);
        const cap = davMaxUploadBytes();
        if ((req.method || "").toUpperCase() === "PUT" && Number.isFinite(declared) && declared > cap) {
            res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" });
            res.end(`The file is larger than this computer accepts (${cap} bytes)`);
            return;
        }
        res.writeContinue();
        onRequest(req, res);
    };

    const wss = new WebSocketServer({ noServer: true });
    for (const listener of [server, localServer]) {
        if (!listener) continue;
        listener.on("checkContinue", onCheckContinue);
        listener.on("upgrade", (req, socket, head) => {
            const check = listener === localServer ? allowsLocalHost : allowsHost;
            if (!check(req.headers.host)) {
                socket.end("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                const challenge = req.headers[DAEMON_CHALLENGE_HEADER];
                if (staticToken && isDaemonChallenge(challenge)) {
                    ws.send(JSON.stringify({ type: DAEMON_PROOF_TYPE, proof: daemonProof(staticToken, challenge) }));
                }
                wss.emit("connection", ws, req);
            });
        });
    }
    setupWebSocketServer(wss, engine, auth, { roster: config.roster, shared: config.shared, staticToken });
    return { server, localServer, wss };
}

interface DaemonParts {
    config: DaemonConfig;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    panelServices: PanelServicesManager;
    server: http.Server | https.Server;
    localServer: http.Server | null;
    wss: WebSocketServer;
    removeHandshake: () => void;
}

// How a running daemon ends. Three ways, each with its own workload policy:
// - stop() (the TUI, an embedding app): ends the workloads, stops panel
//   services at once and closes the servers; an interactive daemon then exits.
// - SIGTERM/SIGINT: ends the daemon, never the workloads it supervises: a
//   service manager's stop or restart (an OS update, a crane update) must
//   not take a game server down. The next daemon adopts them. Panel
//   services get their grace to finish a write.
// - any other process exit: children must never outlive the daemon, so
//   services and workloads are killed, unless a signal already chose to
//   leave the workloads running.
function daemonLifecycle(parts: DaemonParts) {
    const { config, engine, auth, panelServices, server, localServer, wss, removeHandshake } = parts;
    let advertisement: AdvertisementHandle | null = null;
    let leavingWorkloads = false;
    let stopped = false;

    const onExit = () => {
        try {
            removeHandshake();
            auth.flushTokenStore();
        } finally {
            panelServices.stopAll();
            if (leavingWorkloads) engine.releaseAllClients();
            else engine.killAllClients();
        }
    };
    const onSignal = async () => {
        removeHandshake();
        leavingWorkloads = true;
        engine.releaseAllClients();
        try {
            advertisement?.stop();
        } catch (err) { logger.warn("[Paperboard Server] the mDNS advertisement did not stop:", err); }
        await panelServices.stopAllServices();
        removePidFile();
        process.exit(0);
    };
    const stop = () => {
        if (stopped) return;
        stopped = true;
        let handshakeFailure: unknown;
        try { removeHandshake(); }
        catch (err) { handshakeFailure = err; }
        process.off("exit", onExit);
        process.off("SIGTERM", onSignal);
        process.off("SIGINT", onSignal);
        // every step runs whatever the one before did; each failure is named
        const step = (what: string, run: () => void) => {
            try { run(); }
            catch (err) { logger.error(`[Paperboard Server] while stopping, ${what} failed:`, err); }
        };
        step("saving the paired tokens", () => auth.flushTokenStore());
        step("closing the token store", () => auth.dispose());
        // synchronous: an embedded daemon restarted right after
        // never overlaps the services of this one
        step("stopping panel services", () => panelServices.stopAll());
        step("closing the shared documents", () => config.shared.close());
        step("closing the computer list", () => config.roster.close());
        step("stopping the mDNS advertisement", () => {
            advertisement?.stop();
            advertisement = null;
        });
        void engine.disposeClients(3000).catch((err) => logger.error("[Paperboard Server] while stopping, ending the workloads failed:", err));
        step("closing the servers", () => {
            // ws 8 leaves connected sockets open on close(); a
            // stopped daemon must not keep serving them
            for (const client of wss.clients) client.close(1001, "Paperboard Server stopped");
            wss.close();
            localServer?.close();
            server.close(() => {
                if (!config.noAuth && !config.headless) {
                    process.exit(0);
                }
            });
        });
        if (handshakeFailure) throw handshakeFailure;
    };

    return {
        stop,
        // from here on the process's own end follows the policy above
        arm() {
            process.once("exit", onExit);
            process.once("SIGTERM", onSignal);
            process.once("SIGINT", onSignal);
        },
        advertise(handle: AdvertisementHandle | null) {
            advertisement = handle;
        },
    };
}

// A Windows user task runs the daemon under conhost --headless, and ending
// the task ends only conhost: the daemon then stops the way a signal stops
// it, leaving its workloads for the next daemon
function followParent(): void {
    const parent = process.ppid;
    const timer = setInterval(() => {
        try {
            process.kill(parent, 0);
        } catch (err) {
            // quiet: EPERM is a parent that is there, only not ours to signal
            if (errorCode(err) === "EPERM") return;
            clearInterval(timer);
            logger.info(`[Paperboard Server] the process that started the daemon (PID ${parent}) is gone; stopping`);
            process.emit("SIGTERM");
        }
    }, 2000);
    timer.unref();
}

// One attempt to listen on a port. Builds the attempt's own engine, auth and
// servers, and settles once the daemon is ready; a failed bind tears all of
// it down before rejecting, so a retry starts clean.
function listenOnce(config: DaemonConfig, port: number): Promise<ServerInstance> {
    const { options, host, noAuth, headless, staticToken, tlsIdentity } = config;
    return new Promise((resolve, reject) => {
        const panelServices = new PanelServicesManager(getPaperboardDir());
        const engine = new PaperCraneEngine(undefined, panelServices);
        const auth = new PaperCraneAuth(noAuth, undefined, undefined);
        if (staticToken && !noAuth) auth.injectToken(staticToken, "host");
        const { server, localServer, wss } = createListeners(config, engine, auth);
        const handshakeFile = craneHandshakePath();
        const startId = crypto.randomUUID();
        const lifecycle = daemonLifecycle({
            config, engine, auth, panelServices, server, localServer, wss,
            removeHandshake: () => removeCraneHandshake(handshakeFile, startId),
        });

        // this attempt is over: nothing it built stays open
        const abandon = (err: unknown) => {
            try {
                for (const client of wss.clients) client.terminate();
                wss.close();
                localServer?.close();
                server.close();
            } catch (closeErr) { logger.warn("[Paperboard Server] the servers that failed to listen did not close:", closeErr); }
            engine.releaseAllClients();
            try { auth.dispose(); }
            catch (disposeErr) { logger.error("[Paperboard Server] the failed attempt's token store did not close:", disposeErr); }
            reject(err);
        };

        // sync and async bind errors go through one handler; once the port
        // is ours a socket error never tears the server down
        let settled = false;
        const onListenError = (err: any) => {
            if (settled) {
                logger.debug("[Paperboard Server] server socket error after listen:", err?.message ?? err);
                return;
            }
            settled = true;
            abandon(err);
        };
        server.on("error", onListenError);
        // ws re-emits bind errors, so handle them here too
        wss.on("error", onListenError);

        const onReady = (actualPort: number, localPort: number) => {
            if (settled) return;
            // the handshake comes first: nothing starts behind a daemon
            // its own host cannot find
            try {
                writeCraneJson(handshakeFile, localPort, staticToken, startId, { host, port: actualPort, secure: tlsIdentity !== null });
            } catch (err) {
                logger.error("[Paperboard Server] could not write the crane.json handshake; not starting:", err);
                settled = true;
                abandon(err);
                return;
            }
            settled = true;
            lifecycle.arm();
            if (options.exitWithParent) followParent();

            // a restore a crash interrupted is rolled back before any panel reads its
            // files; a panel whose files could not be put back says so, and its
            // service stays stopped rather than run on them half swapped. When which
            // panel is not known, no service starts.
            const keptUntilNextStart = "and its service stays stopped until Paperboard starts again and tries once more.";
            try {
                for (const failed of backupServiceFor(engine).recoverAtStartup()) {
                    const message = `${failed.error}. Its original files are kept at ${failed.kept}, ${keptUntilNextStart}`;
                    if (failed.panelId === null) {
                        logger.error(`[Paperboard Server] an interrupted restore could not be read or undone: ${message}`);
                        panelServices.holdBackAll(`An interrupted restore of an unknown panel couldn't be undone: ${failed.error}. Its files are kept at ${failed.kept}; no panel's service starts until Paperboard starts again and tries once more.`);
                        continue;
                    }
                    problemsFor(engine).report(failed.panelId, { key: "paperboard:interrupted-restore", title: "An interrupted restore couldn't be undone", message: clipProblemReport({ title: "", message }).message });
                    panelServices.holdBack(failed.panelId, `An interrupted restore couldn't be undone: ${message}`);
                }
            } catch (err) {
                logger.error("[Paperboard Server] interrupted restores could not be looked for in backups/.work:", err);
                panelServices.holdBackAll(`Paperboard couldn't look for interrupted restores (${errorMessage(err)}), so no panel's service starts on files a restore may have left half swapped until Paperboard starts again and tries once more.`);
            }

            // Start background services for installed panels
            try {
                panelServices.init(localPort, auth);
            } catch (err) {
                logger.error("[Paperboard Server] no panel service started: the panels folder could not be read:", err);
            }

            // this instance owns the port now: safe to sweep interrupted
            // artifacts (never before — see sweepStartupOrphans)
            engine.sweepStartupOrphans();
            // staged runtime updates nothing runs from any more (the
            // previous run's workloads are gone) install now
            void engine.applyReadyStagedPackages();

            // announce over mDNS, with who this daemon is: a loopback-only
            // daemon has no TLS identity and nothing to announce
            if (options.advertise !== false && tlsIdentity) {
                lifecycle.advertise(advertisePaperCrane({ port: actualPort, host, fingerprint: certFingerprint(tlsIdentity.cert) }));
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
                new PaperCraneTui({
                    host,
                    port: actualPort,
                    secure: tlsIdentity !== null,
                    auth,
                    onStop: lifecycle.stop,
                }).start();
            }

            resolve({ server, wss, engine, auth, records: config.records, roster: config.roster, port: actualPort, localPort, host, stop: lifecycle.stop });
        };

        const onListening = () => {
            // adopted only once the port is ours: an attempt that loses
            // it to a stale daemon holds no supervisor
            engine.recoverRunningSupervisors().catch((err) => {
                logger.error("[Paperboard Server] Failed to recover running supervisors:", err);
            });
            const addr = server.address();
            const actualPort = typeof addr === "object" && addr ? addr.port : port;
            if (!localServer) {
                onReady(actualPort, actualPort);
                return;
            }
            localServer.once("error", onListenError);
            localServer.listen(0, "127.0.0.1", () => {
                const local = localServer.address();
                onReady(actualPort, typeof local === "object" && local ? local.port : 0);
            });
        };

        try {
            server.listen(port, host, onListening);
        } catch (err) {
            onListenError(err);
        }
    });
}
