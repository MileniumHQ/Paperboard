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
import { DEFAULT_LISTEN_PORT, EXIT } from "../cli/cli";
import { getLocalDir, getPaperboardDir, ensurePrivateDir } from "../core/paths";
import { claimDataFolder, FolderClaimedError, type DataFolderMovedError, type FolderClaim } from "../core/folderClaim";
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
import { mdnsHostName } from "./hostname";
import { LINK_PATH, NetworkLinks } from "../network/links";
import { SharedDocuments } from "../network/shared";
import type { RecordStore } from "../network/store";
import { importPairedComputers } from "../network/importPairedComputers";

/** where the other computers dial a daemon listening on `host`: its mDNS name when it listens everywhere, else that address; null when it has no name to give */
function ownDial(host: string, port: number): { host: string; port: number } | null {
    const everywhere = host === "0.0.0.0" || host === "::" || host === "";
    const name = everywhere ? mdnsHostName() : host;
    return name ? { host: name, port } : null;
}

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
    /** the links to the other members, and the sync over them */
    network: NetworkLinks;
    port: number;
    // plaintext loopback port for this machine's own clients (crane.json,
    // panel services). Equals port when the daemon is loopback-only.
    localPort: number;
    host: string;
    /**
     * Stops the daemon. Everything but the record store ends at once; the
     * promise resolves once the store is closed too, which whoever starts a
     * daemon on the same data folder next waits for.
     */
    stop: () => Promise<void>;
    /**
     * Settles once the daemon has stopped, however it stopped: with the
     * reason when it stopped on its own (its data folder was moved, deleted
     * or replaced while it ran: core/folderClaim.ts), else null.
     */
    ended: Promise<DataFolderMovedError | null>;
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
    /** this daemon's claim on its data folder (core/folderClaim.ts): ended once the roster is closed */
    claim: FolderClaim;
    network: NetworkLinks;
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

// TODO(remove after v0.6): a daemon of Paperboard 0.4 or before, which takes
// no folder claim, still running on this folder while a newer one starts
// (an update that left the old standalone daemon up). A daemon of this
// version or later holds the claim, and is refused by it first; so this
// catches nothing else. A second one would overwrite crane.json, hiding
// the first from every local client, and delete it on exit. Only a daemon
// that proves it holds this folder's token counts: a stale crane.json whose
// port another program now answers on owns nothing.
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

/** the data folder's claim; when another daemon holds it, which one, when its handshake says (read only: nothing is written without the claim) */
async function claimFolder(): Promise<FolderClaim> {
    try {
        return await claimDataFolder();
    } catch (err) {
        // a server on this path but another folder: crane.json here isn't its (it moved with its folder)
        if (!(err instanceof FolderClaimedError) || err.held !== "folder") throw err;
        const status = await readDaemonStatus().catch(() => null); // quiet: only names the daemon that holds the folder; the claim's own error is thrown either way
        if (!status?.running) throw err;
        throw new FolderClaimedError(
            `A Paperboard server daemon is already running for ${status.dataDir}${status.pid !== undefined ? ` (PID ${status.pid})` : ""}. Stop it first, or start this one with another --data-dir.`,
            "folder",
        );
    }
}

export async function startPaperCraneServer(
    options: ServerOptions = {},
): Promise<ServerInstance> {
    const host = options.host ?? DEFAULT_HOST;
    if (options.noAuth && !isLoopbackHost(host)) {
        throw new Error(`--no-auth only runs on a loopback host, not ${host}`);
    }
    // the folder is this daemon's before anything in it is read or written: a second daemon started
    // at the same moment stops here, with nothing written (core/folderClaim.ts)
    const claim = await claimFolder();
    try {
        await refuseRunningDaemon();
    } catch (err) {
        await claim.releaseAfter(Promise.resolve());
        throw err;
    }
    // what Paperboard can't guarantee for this folder, said where a person running it sees it
    for (const limit of claim.limits) logger.warn(`[Paperboard Server] ${limit}`);

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
    let roster: Roster;
    let members: RosterRecords;
    let identity: TlsIdentity;
    const localDir = getLocalDir();
    try {
        ensurePrivateDir(localDir);
        identity = loadOrCreateTlsIdentity(localDir);
        members = await RosterRecords.open(path.join(localDir, NETWORK_DIR), identity);
        roster = await Roster.open(localDir, identity, members);
    } catch (err) {
        await claim.releaseAfter(Promise.resolve());
        throw err;
    }
    // from here on a start that fails closes what it opened, and the folder is free again: nothing throws past this without it
    let shared: SharedDocuments | null = null;
    const abandon = async (err: unknown): Promise<never> => {
        shared?.close();
        await claim.releaseAfter(roster.close());
        throw err;
    };
    let config: DaemonConfig;
    try {
        try {
            // TODO(remove after v0.6): the desktop app's own list from 0.4 and before
            await importPairedComputers(localDir, roster);
        } catch (err) {
            throw new Error(`The paired computers couldn't be moved into the computer list (local/paired_computers.json is kept as it was, and the next start tries again): ${errorMessage(err)}`, { cause: err });
        }
        // what this computer is now, saved before anyone asks for the list
        await roster.refreshSelfFacts().catch((err) => {
            logger.error("[Paperboard Server] this computer's OS details couldn't be read; the computer list keeps the ones it had:", err); // quiet: the roster keeps the last details it read, and the next start reads them again
        });
        shared = new SharedDocuments({ store: members.records, nameOf: (id) => roster.member(id)?.name });
        config = {
            options,
            host,
            noAuth,
            headless: options.headless ?? false,
            staticToken: options.staticToken ?? (noAuth ? null : crypto.randomBytes(24).toString("hex")),
            tlsIdentity: isLoopbackHost(host) ? null : identity,
            roster,
            claim,
            // a daemon on loopback only can't be dialed: it dials out
            network: new NetworkLinks({ identity, roster, store: members.records, listening: !isLoopbackHost(host) }),
            records: members.records,
            shared,
        };
    } catch (err) {
        return abandon(err);
    }

    const port = options.port ?? DEFAULT_PORT;
    for (;;) {
        let failure: any;
        try {
            return await listenOnce(config, port);
        } catch (err) {
            failure = err;
        }
        const inUse = failure?.code === "EADDRINUSE" || /already in use|in use/i.test(failure?.message || "");
        if (!inUse) return abandon(failure);
        let freed: boolean;
        try {
            freed = await killStalePaperCrane(port);
        } catch (err) {
            return abandon(err);
        }
        if (freed) continue;
        // Port is held by a foreign, non-PaperCrane application.
        // The caller prints it (main.ts fatalCliError) or shows it
        // (the desktop app): printing it here too said it twice
        return abandon(
            Object.assign(
                new Error(
                    `Port ${port} is already in use by another application.\n` +
                    `  Run with --port <number> to choose a different port, or free up port ${port} first.`,
                ),
                { code: "EADDRINUSE", port },
            ),
        );
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
            // A link proves it is a member's daemon with a signature by that
            // daemon's key (network/links.ts), which no browser holds, so the
            // Host check that guards browsers isn't its gate. Links are made
            // only over TLS: the dialer pins this computer's key.
            if ((req.url ?? "").split("?")[0] === LINK_PATH) {
                if (tlsIdentity && listener === server) config.network.accept(req, socket, head);
                else socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                return;
            }
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

// How a running daemon ends: one stop, however it begins, each way with its
// own workload policy:
// - stop() (the TUI, an embedding app): ends the workloads, stops panel
//   services at once and closes the servers; an interactive daemon then exits.
// - SIGTERM/SIGINT: ends the daemon, never the workloads it supervises: a
//   service manager's stop or restart (an OS update, a crane update) must
//   not take a game server down. The next daemon adopts them. Panel
//   services get their grace to finish a write. The process then exits.
// - the data folder moved, deleted or replaced while the daemon runs
//   (core/folderClaim.ts): as stop(), but nothing more is written at the
//   data path, the tokens and the PID file included; a daemon run from the
//   command line then exits with a failure (main.ts), and its clients are
//   told why.
// - any other process exit: children must never outlive the daemon, so
//   services and workloads are killed, unless a signal already chose to
//   leave the workloads running.
// A signal that comes while the daemon is stopping waits for that same stop,
// then the process exits: the data is closed before the process goes,
// however many signals come.
function daemonLifecycle(parts: DaemonParts) {
    const { config, engine, auth, panelServices, server, localServer, wss, removeHandshake } = parts;
    let advertisement: AdvertisementHandle | null = null;
    let tui: PaperCraneTui | null = null;
    let leavingWorkloads = false;
    let stopped = false;
    let lost: DataFolderMovedError | null = null;
    let unwatchFolder: (() => void) | null = null;
    let tellEnded!: (why: DataFolderMovedError | null) => void;
    const ended = new Promise<DataFolderMovedError | null>((resolve) => (tellEnded = resolve));

    const onExit = () => {
        try {
            removeHandshake();
            if (!lost) auth.flushTokenStore();
        } finally {
            panelServices.stopAll();
            if (leavingWorkloads) engine.releaseAllClients();
            else engine.killAllClients();
        }
    };
    // The one way the data folder is let go, however the daemon stops: the
    // links end at once, and a pull that is mid-write finishes its write and
    // their last-seen times are saved; only then are the shared documents and
    // the computer list closed, and once their last writes are saved the
    // folder is free (core/folderClaim.ts). Whoever opens the folder again (an
    // embedded daemon started right after) waits for it, so two never write
    // one store.
    const closeData = (): Promise<void> =>
        config.claim.releaseAfter(
            config.network
                .stop()
                .catch((err) => logger.error("[Paperboard Server] while stopping, ending the links to the other computers failed:", err))
                .then(() => {
                    try { config.shared.close(); }
                    catch (err) { logger.error("[Paperboard Server] while stopping, closing the shared documents failed:", err); }
                    return config.roster.close().catch((err) => logger.error("[Paperboard Server] while stopping, saving the computer list's last changes failed:", err));
                }),
        );

    let ending: Promise<void> | null = null;
    /** the stop (the top of this function); every later call answers the one already under way */
    const end = (how: "stop" | "signal" | "lost", exitAfter: boolean): Promise<void> => {
        if (ending) return ending;
        stopped = true;
        unwatchFolder?.();
        if (how === "signal") leavingWorkloads = true;
        // every step runs whatever the one before did; each failure is named
        const step = (what: string, run: () => void) => {
            try { run(); }
            catch (err) { logger.error(`[Paperboard Server] while stopping, ${what} failed:`, err); }
        };
        let handshakeFailure: unknown;
        try { removeHandshake(); }
        catch (err) { handshakeFailure = err; }
        step("giving the terminal back", () => tui?.release());
        // a folder that isn't this daemon's any more gets nothing more written
        if (!lost) step("saving the paired tokens", () => auth.flushTokenStore());
        step("closing the token store", () => auth.dispose());
        // synchronous, but for a signal's grace: an embedded daemon restarted
        // right after never overlaps the services of this one
        if (how !== "signal") step("stopping panel services", () => panelServices.stopAll());
        step("stopping the mDNS advertisement", () => {
            advertisement?.stop();
            advertisement = null;
        });
        if (how === "signal") engine.releaseAllClients();
        else void engine.disposeClients(3000).catch((err) => logger.error("[Paperboard Server] while stopping, ending the workloads failed:", err));
        const closed = new Promise<void>((resolve) => {
            step("closing the servers", () => {
                // ws 8 leaves connected sockets open on close(); a
                // stopped daemon must not keep serving them. A close reason is at most 123 bytes
                const why = lost ? "The data folder was moved or replaced while Paperboard was running" : "Paperboard Server stopped";
                for (const client of wss.clients) client.close(1001, why);
                wss.close();
                localServer?.close();
                server.close(() => resolve());
            });
        });
        ending = (async () => {
            if (how === "signal") await panelServices.stopAllServices();
            await closeData();
            if (!lost) removePidFile();
        })().finally(() => {
            process.off("exit", onExit);
            process.off("SIGTERM", onSignal);
            process.off("SIGINT", onSignal);
            tellEnded(lost);
        });
        // the process goes only once the record store is closed: a pull mid-write finishes it first
        if (exitAfter) void Promise.all([ending, closed]).then(() => process.exit(lost ? EXIT.FAILURE : 0));
        if (handshakeFailure) throw handshakeFailure;
        return ending;
    };
    const onSignal = () => {
        // a stop already under way is waited for, then the process exits as the signal asked
        let stopping: Promise<void>;
        try {
            stopping = end("signal", false);
        } catch (err) {
            logger.error("[Paperboard Server] while stopping, removing crane.json failed:", err);
            stopping = ending ?? Promise.resolve();
        }
        void stopping.then(() => process.exit(lost ? EXIT.FAILURE : 0));
    };

    return {
        /**
         * Stops the daemon. A daemon with a TUI ends its process once its data is
         * closed, unless the stop is a start that failed (`exitAfter` false): that
         * start rejects, and whoever started it says why.
         */
        stop: (exitAfter = !config.noAuth && !config.headless) => end("stop", exitAfter),
        stopped: () => stopped,
        /** settles once the daemon has stopped: with why, when it stopped on its own (its data folder moved) */
        ended,
        // from here on the process's own end follows the policy above
        arm() {
            process.once("exit", onExit);
            // on, not once: a second signal while stopping waits for the stop too
            process.on("SIGTERM", onSignal);
            process.on("SIGINT", onSignal);
            unwatchFolder = config.claim.onLost((err) => {
                lost = err;
                logger.error(`[Paperboard Server] ${err.message}`);
                void end("lost", !config.noAuth && !config.headless).catch((stopErr) => logger.error("[Paperboard Server] stopping after the data folder moved didn't finish cleanly:", stopErr));
            });
        },
        advertise(handle: AdvertisementHandle | null) {
            advertisement = handle;
        },
        showing(shown: PaperCraneTui) {
            tui = shown;
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

        // A start that fails once it is listening stops what it started, and rejects:
        // whoever started it (the app's embedded daemon, the CLI) hears why, never waits
        const failAfterListening = (err: unknown) => {
            void Promise.resolve()
                .then(() => lifecycle.stop(false))
                .catch((stopErr) => logger.error("[Paperboard Server] stopping a start that failed didn't finish cleanly:", stopErr))
                .then(() => reject(err));
        };

        const onReady = (actualPort: number, localPort: number) => {
            try {
                ready(actualPort, localPort);
            } catch (err) {
                // before it is settled nothing has started: the attempt is only abandoned
                if (!settled) {
                    settled = true;
                    abandon(err);
                    return;
                }
                failAfterListening(err);
            }
        };

        const ready = (actualPort: number, localPort: number) => {
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

            // where the other computers dial this one, said by this one alone (nothing while only it can
            // reach itself), before the start is done: no write outlives a stop that follows
            const listensAt = tlsIdentity ? ownDial(host, actualPort) : null;
            void config.roster
                .listensAt(listensAt)
                .catch((err) => {
                    logger.error("[Paperboard Server] where this computer listens couldn't be saved for the other computers; they dial it where they last reached it:", err); // quiet: the next start says it again
                })
                .then(() => {
                    // stopped while it was saying where it listens (an embedding app gave up): nothing more starts
                    if (!lifecycle.stopped()) {
                        // links are taken and dialed once this daemon is the one listening
                        config.network.start();
                        // the TUI last, once everything its stop ends is running
                        if (noAuth || headless) {
                            console.log(`[Paperboard Server] Listening on ${tlsIdentity ? "https" : "http"}://${getDisplayHost(host)}:${actualPort}`);
                        } else {
                            // pairing opens only when asked: [p] in the TUI, or
                            // --start-pairing at launch. A daemon listening on the
                            // LAN never offers a pairing code on its own.
                            if (options.startPairing) auth.startPairing();
                            const tui = new PaperCraneTui({ host, port: actualPort, secure: tlsIdentity !== null, auth, onStop: () => lifecycle.stop() });
                            lifecycle.showing(tui);
                            tui.start();
                        }
                    }
                    resolve({ server, wss, engine, auth, records: config.records, roster: config.roster, network: config.network, port: actualPort, localPort, host, stop: () => lifecycle.stop(), ended: lifecycle.ended });
                })
                .catch(failAfterListening);
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
