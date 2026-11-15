// The connection to one computer's Paperboard Server: the local identity
// proof, the embedded daemon, pinned TLS for paired remotes, reconnects
// with backoff, the heartbeat and the RPC framing. What the daemon can be
// asked is PaperCraneClient.ts.
import { WebSocket, type RawData } from "ws";
import { logger } from "../../../../papercrane/logger";
import { EventEmitter } from "events";
import * as path from "path";
import * as crypto from "crypto";
import { startPaperCraneServer, ServerInstance, DEFAULT_PORT } from "../../../../papercrane";
import { PROTOCOL_VERSION } from "../../../../papercrane/protocol";
import {
    readCraneHandshake, verifyDaemonProof,
    DAEMON_CHALLENGE_HEADER, DAEMON_PROOF_TYPE,
    type CraneHandshakeFile,
} from "../../../../papercrane/handshake";
import { getLocalDir } from "../../../../papercrane/paths";
import {
    peerCertPem,
    pinnedRequest,
    pinnedTlsOptions,
    type PinnedRequestInit,
    type PinnedResponse,
} from "../../../../papercrane/pinnedTls";
import type { TLSSocket } from "tls";
import { pinnableWebSocket } from "../../../../papercrane/pinnableWebSocket";
import { bracketHost, isLoopback } from "./probeTarget";

export type RpcParams = Record<string, unknown>;

export interface ProgressPayload {
    stage:
        | "starting"
        | "checking"
        | "stopping"
        | "downloading"
        | "verifying"
        | "extracting"
        | "completed"
        | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
    // update:inUse: which of its updates this is about
    target?: string;
}

// Prove the peer on the very socket that will carry credentials. A proof
// from a separate HTTP probe would leave a port-replacement race before WS.
async function verifiedLocalSocket(creds: CraneHandshakeFile): Promise<WebSocket> {
    const challenge = crypto.randomBytes(32).toString("hex");
    const Socket = pinnableWebSocket();
    const ws = new Socket(`ws://127.0.0.1:${creds.port}`, {
        headers: { [DAEMON_CHALLENGE_HEADER]: challenge },
        handshakeTimeout: 1500,
        maxPayload: 16 * 1024 * 1024,
    });
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => fail(new Error("Local daemon identity proof timed out")), 1500);
        const cleanup = () => {
            clearTimeout(timer);
            ws.off("message", onProof);
            ws.off("close", closed);
        };
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            ws.terminate();
            reject(err);
        };
        const closed = () => fail(new Error("Local daemon closed before proving its identity"));
        const onProof = (raw: RawData) => {
            try {
                const text = raw.toString();
                if (text.length > 1024) throw new Error("Oversized local daemon identity proof");
                const message = JSON.parse(text);
                if (message.type !== DAEMON_PROOF_TYPE || !verifyDaemonProof(creds.token, challenge, message.proof)) {
                    throw new Error("Local daemon identity proof mismatch");
                }
                settled = true;
                cleanup();
                ws.off("error", fail);
                resolve(ws);
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
            }
        };
        ws.once("message", onProof);
        ws.once("error", fail);
        ws.once("close", closed);
    });
}

export interface TargetStatus {
    connected: boolean;
    isRemote: boolean;
    host: string;
    port: number;
    error?: string;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

// a daemon closes a socket that has not authenticated within its handshake
// window (10s), so the token is verified as part of connecting
const AUTH_TIMEOUT_MS = 10_000;

export interface PaperCraneClientOptions {
    /** ping interval; a socket that misses one pong is treated as dead */
    heartbeatMs?: number;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
}

// the daemon answered a call with an error (as opposed to a timeout or a
// dropped socket, which say nothing about the request itself)
class DaemonRefusal extends Error {}

// Close codes after which retrying with the same credential cannot work.
const CREDENTIAL_CLOSE_CODES = new Set([4401, 4403]);
export class PaperCraneConnection extends EventEmitter {
    private ws: WebSocket | null = null;
    private host: string = "localhost";
    private port: number = DEFAULT_PORT;
    protected token?: string;
    // remote daemon certificate: pinned after pairing, captured during it
    private cert?: string;
    private trustOnFirstUse = false;
    private embeddedServer: ServerInstance | null = null;
    private isConnected: boolean = false;
    private localIdentityVerified = false;
    private requestIdCounter = 1;
    private pendingRequests = new Map<
        number,
        {
            resolve: (val: unknown) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
            socket: WebSocket;
        }
    >();
    // single-flight guard so concurrent calls don't race reentrant connects
    private connectingPromise: Promise<TargetStatus> | null = null;
    // Every connect or disconnect starts a new generation; handlers of an
    // older socket see a stale generation and leave the client alone.
    private generation = 0;
    // what the owner asked to connect to, replayed by automatic reconnects
    // (a local client re-resolves its daemon instead of reusing a token)
    private target: { host: string; port?: number; token?: string; cert?: string } | null = null;
    private heartbeat: NodeJS.Timeout | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private reconnectAttempts = 0;
    // why the last connection attempt or connection ended, shown while offline
    private lastError?: string;
    // set when the daemon refused the credential; retrying cannot help
    private credentialRejected = false;
    // a ping is out and no pong came back yet
    private awaitingPong = false;
    private readonly heartbeatMs: number;
    private readonly reconnectBaseMs: number;
    private readonly reconnectMaxMs: number;
    // progress pushes by download id, while the call they belong to runs
    protected readonly progressListeners = new Map<string, (payload: ProgressPayload) => void>();

    constructor(options: PaperCraneClientOptions = {}) {
        super();
        this.heartbeatMs = options.heartbeatMs ?? 15_000;
        this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
        this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
    }

    public getEmbeddedServer(): ServerInstance | null {
        return this.embeddedServer;
    }

    public getHost(): string {
        return this.host;
    }

    public getPort(): number {
        return this.port;
    }

    public getToken(): string | undefined {
        return this.token;
    }

    public getLocalCredentials(): CraneHandshakeFile | null {
        if (!this.isConnected || !this.localIdentityVerified || !isLoopback(this.host) || !this.token) return null;
        return { port: this.port, token: this.token };
    }

    public getCert(): string | undefined {
        return this.cert;
    }

    // HTTP to this computer's daemon: plaintext on loopback, pinned TLS
    // for a paired remote
    public async request(subpath: string, init: PinnedRequestInit = {}): Promise<PinnedResponse> {
        const cleanSub = subpath.startsWith("/") ? subpath : `/${subpath}`;
        if (isLoopback(this.host)) {
            const res = await fetch(`http://${this.host}:${this.port}${cleanSub}`, {
                method: init.method,
                headers: init.headers,
                body: init.body,
                signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
            });
            return {
                status: res.status,
                ok: res.ok,
                headers: Object.fromEntries(res.headers),
                body: Buffer.from(await res.arrayBuffer()),
            };
        }
        if (!this.cert) throw new Error(this.missingCertMessage());
        return pinnedRequest(`https://${bracketHost(this.host)}:${this.port}${cleanSub}`, this.cert, init);
    }

    private missingCertMessage(): string {
        return `${this.host} has no pinned certificate. Remove this computer and pair it again`;
    }

    public getStatus(): TargetStatus {
        const isRemote = !isLoopback(this.host);
        return {
            connected: this.isConnected,
            isRemote,
            host: this.host,
            port: this.port,
            ...(!this.isConnected && this.lastError ? { error: this.lastError } : {}),
        };
    }

    /**
     * Connects to an unpaired remote daemon and accepts whatever certificate
     * it presents. That certificate is pinned for every later connection.
     */
    public async connectForPairing(host: string, port: number): Promise<TargetStatus> {
        this.trustOnFirstUse = true;
        try {
            return await this.connect(host, port);
        } finally {
            this.trustOnFirstUse = false;
        }
    }

    public async connect(
        host = "127.0.0.1",
        port?: number,
        token?: string,
        cert?: string,
    ): Promise<TargetStatus> {
        if (this.connectingPromise) return this.connectingPromise;
        // pairing dials without a credential and must not be retried
        this.target = this.trustOnFirstUse ? null : { host, port, token, cert };
        this.connectingPromise = this.open(host, port, token, cert).finally(() => {
            this.connectingPromise = null;
        });
        return this.connectingPromise;
    }

    // this data directory's daemon, proven by its handshake; else a fresh
    // embedded one, which this client owns
    private async localDaemonSocket(gen: number): Promise<WebSocket> {
        const socket = (await this.storedDaemonSocket()) ?? (await this.startEmbeddedDaemon());
        if (gen !== this.generation) {
            socket.terminate();
            throw new Error("Connection attempt was superseded");
        }
        return socket;
    }

    // the daemon crane.json names, once it proved it is this data directory's
    private async storedDaemonSocket(): Promise<WebSocket | null> {
        const stored = readCraneHandshake();
        if (!stored) return null;
        try {
            const socket = await verifiedLocalSocket(stored);
            this.port = stored.port;
            this.token = stored.token;
            return socket;
        } catch (err) {
            // Recovery is a freshly authenticated daemon; never send the
            // stored credential to a peer that failed proof.
            logger.warn("[PaperCraneClient] local daemon identity unavailable; starting a fresh daemon:", err);
            return null;
        }
    }

    private async startEmbeddedDaemon(): Promise<WebSocket> {
        try {
            this.embeddedServer?.stop();
            this.embeddedServer = null;
            const freshToken = "pc_" + crypto.randomBytes(24).toString("hex");
            this.embeddedServer = await startPaperCraneServer({
                port: 0,
                host: "127.0.0.1",
                headless: true,
                staticToken: freshToken,
                remotesFile: path.join(getLocalDir(), "paired_computers.json"),
            });
            if (this.embeddedServer?.port) {
                this.port = this.embeddedServer.port;
                this.token = freshToken;
            }
            return await verifiedLocalSocket({ port: this.port, token: freshToken });
        } catch (err) {
            this.embeddedServer?.stop();
            this.embeddedServer = null;
            throw new Error(`Paperboard Server couldn't start on this computer: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }

    private async open(
        host: string,
        port: number | undefined,
        token: string | undefined,
        cert: string | undefined,
    ): Promise<TargetStatus> {
        this.closeSocket();
        const gen = this.generation;
        this.host = host;
        if (port) this.port = port;
        this.token = token;
        this.cert = cert;

        // a connection that fails before it has a socket: the rail shows why
        // this computer is offline
        const failBeforeSocket = (err: unknown, retry: boolean): never => {
            if (gen === this.generation) {
                this.lastError = err instanceof Error ? err.message : String(err);
                this.emit("status", this.getStatus());
                if (retry) this.scheduleReconnect();
            }
            throw err;
        };

        const isLocal = isLoopback(host);
        if (!isLocal && !cert && !this.trustOnFirstUse) failBeforeSocket(new Error(this.missingCertMessage()), false);

        let localSocket: WebSocket | undefined;
        if (isLocal && !token) {
            // a daemon that didn't start may start on the next try
            try { localSocket = await this.localDaemonSocket(gen); }
            catch (err) { failBeforeSocket(err, true); }
        }

        this.localIdentityVerified = localSocket !== undefined;
        let ws: WebSocket;
        try {
            const Socket = pinnableWebSocket();
            ws = localSocket ?? (isLocal
                ? new Socket(`ws://${host}:${this.port}`)
                : new Socket(
                      `wss://${bracketHost(host)}:${this.port}`,
                      cert ? pinnedTlsOptions(cert) : { rejectUnauthorized: false },
                  ));
        } catch (err) {
            // an unreadable pinned certificate fails the same way every time
            failBeforeSocket(new Error(`Cannot connect to ${bracketHost(host)}:${this.port}: ${err instanceof Error ? err.message : String(err)}`, { cause: err }), false);
        }
        return new Promise((resolve, reject) => {
            this.ws = ws;
            let settled = false;
            const current = () => gen === this.generation && this.ws === ws;
            const fail = (message: string) => {
                this.lastError = message;
                if (settled) return;
                settled = true;
                reject(new Error(message));
            };

            if (!isLocal && !cert) {
                // pairing: capture the certificate before any credential is sent
                ws.on("upgrade", (res) => {
                    try {
                        this.cert = peerCertPem(res.socket as TLSSocket);
                    } catch (err) {
                        ws.emit("error", err);
                        ws.terminate();
                    }
                });
            }

            const onOpen = async () => {
                if (!current()) return;
                // An open socket is not an authenticated one. Verify the
                // credential before reporting connected: the daemon closes
                // a socket that stays unauthenticated past its handshake
                // window, which showed an idle remote as "Connection Lost"
                // seconds after every launch.
                if (this.token) {
                    try {
                        await this.request_("auth:verify", {}, AUTH_TIMEOUT_MS, ws);
                    } catch (err) {
                        if (!current()) return;
                        const reason = err instanceof Error ? err.message : String(err);
                        if (err instanceof DaemonRefusal) {
                            this.credentialRejected = true;
                            fail(`${host} refused this app's pairing (${reason}). Remove this computer and pair it again`);
                        } else {
                            fail(`Could not sign in to ${host}: ${reason}`);
                        }
                        ws.close();
                        return;
                    }
                    if (!current()) return;
                }
                this.isConnected = true;
                this.lastError = undefined;
                this.reconnectAttempts = 0;
                this.startHeartbeat(ws);
                this.emit("status", this.getStatus());
                if (!settled) {
                    settled = true;
                    resolve(this.getStatus());
                }
            };
            ws.on("open", onOpen);
            if (ws.readyState === WebSocket.OPEN) queueMicrotask(onOpen);

            ws.on("error", (err: Error) => {
                if (!current()) return;
                fail(
                    `Cannot connect to the Paperboard server daemon at ${bracketHost(host)}:${this.port}` +
                        (err?.message ? `: ${err.message}` : ""),
                );
                this.emit("status", this.getStatus());
            });

            ws.on("message", (raw: RawData) => this.onFrame(ws, raw));

            ws.on("close", (code: number, reason: Buffer) => {
                // calls sent on this socket can never be answered now
                for (const [id, pending] of this.pendingRequests) {
                    if (pending.socket !== ws) continue;
                    this.pendingRequests.delete(id);
                    clearTimeout(pending.timer);
                    pending.reject(new Error("Paperboard Server connection closed"));
                }
                if (!current()) return;
                this.stopHeartbeat();
                this.ws = null;
                this.isConnected = false;
                this.localIdentityVerified = false;
                const why = reason?.toString("utf8");
                if (CREDENTIAL_CLOSE_CODES.has(code)) {
                    this.credentialRejected = true;
                    this.lastError = `${host} closed the connection: ${why || code}. Remove this computer and pair it again`;
                } else if (!this.lastError) {
                    this.lastError = why ? `Connection closed: ${why}` : "Connection closed";
                }
                fail(this.lastError);
                this.emit("status", this.getStatus());
                this.scheduleReconnect();
            });
        });
    }

    // a daemon frame: an answer to a call on this socket, or a push
    private onFrame(ws: WebSocket, raw: RawData): void {
        let msg: { type?: string; id?: number; error?: string; result?: unknown; event?: string; payload?: Record<string, unknown> };
        try {
            msg = JSON.parse(raw.toString());
        } catch (err) {
            // a frame this app can't read may have been an answer: the
            // socket's calls fail now instead of each waiting out its timeout
            logger.error(`[PaperCraneClient] ${this.host} sent a frame that isn't JSON; closing the connection:`, err);
            if (this.ws === ws) this.lastError = "Paperboard Server sent a message this app can't read";
            ws.terminate();
            return;
        }
        if (msg.type === "response") {
            const handler = msg.id !== undefined ? this.pendingRequests.get(msg.id) : undefined;
            if (!handler || handler.socket !== ws) return;
            this.pendingRequests.delete(msg.id!);
            clearTimeout(handler.timer);
            if (msg.error) handler.reject(new DaemonRefusal(msg.error));
            else handler.resolve(msg.result);
        } else if (msg.type === "event") {
            this.handlePushEvent(msg.event ?? "", msg.payload ?? {});
        }
    }

    // A computer that drops (sleep, network change, daemon restart) comes
    // back by itself: one pending retry at a time, exponential backoff.
    private scheduleReconnect(): void {
        if (!this.target || this.credentialRejected || this.reconnectTimer) return;
        const delay = Math.min(
            this.reconnectBaseMs * 2 ** this.reconnectAttempts,
            this.reconnectMaxMs,
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectNow();
        }, delay);
        this.reconnectTimer.unref?.();
    }

    private reconnectNow(): void {
        const target = this.target;
        if (!target) return;
        this.connect(target.host, target.port, target.token, target.cert).catch((err) => {
            // the attempt's close handler schedules the next one
            logger.debug(`[PaperCraneClient] reconnect to ${target.host} failed:`, err);
        });
    }

    /**
     * The machine woke up or the network changed: a sleeping socket can look
     * open while its peer is long gone. Probe a connected socket at once and
     * retry a disconnected one now instead of waiting out the backoff.
     */
    public wake(): void {
        if (this.isConnected && this.ws) {
            this.probeHeartbeat(this.ws);
            return;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectAttempts = 0;
        if (!this.credentialRejected) this.reconnectNow();
    }

    private startHeartbeat(ws: WebSocket): void {
        this.stopHeartbeat();
        this.awaitingPong = false;
        ws.on("pong", () => {
            this.awaitingPong = false;
        });
        this.heartbeat = setInterval(() => this.probeHeartbeat(ws), this.heartbeatMs);
        this.heartbeat.unref?.();
    }

    private probeHeartbeat(ws: WebSocket): void {
        if (this.ws !== ws) return;
        if (this.awaitingPong) {
            // no answer since the last ping: the peer or the path is gone
            this.lastError = "The computer stopped responding";
            ws.terminate();
            return;
        }
        this.awaitingPong = true;
        try {
            ws.ping();
        } catch (err) {
            logger.debug("[PaperCraneClient] ping failed:", err);
            ws.terminate();
        }
    }

    private stopHeartbeat(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
    }

    // ends the current socket without touching the owner's intent
    private closeSocket(): void {
        this.generation++;
        this.localIdentityVerified = false;
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.credentialRejected = false;
        if (this.ws) {
            try {
                this.ws.close();
            } catch (err) {
                logger.debug("[PaperCraneClient] closing the old socket threw:", err);
            }
            this.ws = null;
        }
        this.isConnected = false;
    }

    // the owner is done with this computer: no automatic reconnects
    public disconnect() {
        this.target = null;
        this.closeSocket();
    }

    // separate from disconnect so reconnects never kill long-running children
    public stopEmbeddedServer(): void {
        this.embeddedServer?.stop();
        this.embeddedServer = null;
    }

    // panels own their streams through PaperAPI's transport; this client
    // only hears progress for the updater's package downloads
    private handlePushEvent(
        event: string,
        payload: Record<string, unknown>,
    ) {
        if (event === "progress") {
            this.progressListeners
                .get(payload.downloadId as string)
                ?.(payload as unknown as ProgressPayload);
        }
    }

    public async call<T = unknown>(
        action: string,
        params: RpcParams = {},
        timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
    ): Promise<T> {
        if (this.connectingPromise) await this.connectingPromise;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            const t = this.target ?? { host: this.host, port: this.port, token: this.token, cert: this.cert };
            await this.connect(t.host, t.port, t.token, t.cert);
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Cannot connect to the Paperboard server daemon at ${bracketHost(this.host)}:${this.port}`);
        }

        return this.request_<T>(action, params, timeoutMs, this.ws);
    }

    private request_<T = unknown>(
        action: string,
        params: RpcParams,
        timeoutMs: number,
        socket: WebSocket,
    ): Promise<T> {
        const id = this.requestIdCounter++;
        // token last: a params object that happens to carry a token (or a
        // typo'd field) can never clobber the real credential — same
        // polarity as PaperAPI's CraneTransport. v marks the wire protocol
        // version from the shared constant; the daemon refuses unknown
        // versions with a typed BAD_PROTOCOL error instead of guessing.
        const finalParams = { ...params, token: this.token, v: PROTOCOL_VERSION };
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Paperboard Server RPC '${action}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(id, {
                resolve: resolve as (val: unknown) => void,
                reject,
                timer,
                socket,
            });
            socket.send(JSON.stringify({ id, action, params: finalParams }));
        });
    }

    protected async withProgress<T>(
        options: { onProgress?: (payload: ProgressPayload) => void },
        run: (downloadId: string | null) => Promise<T>,
    ): Promise<T> {
        if (!options.onProgress) return run(null);
        return this.withProgressId(`progress-${crypto.randomUUID()}`, options.onProgress, run);
    }

    // progress pushes carrying this id go to onProgress while run runs
    protected async withProgressId<T>(
        downloadId: string,
        onProgress: (payload: ProgressPayload) => void,
        run: (downloadId: string) => Promise<T>,
    ): Promise<T> {
        this.progressListeners.set(downloadId, onProgress);
        try {
            return await run(downloadId);
        } finally {
            this.progressListeners.delete(downloadId);
        }
    }
}
