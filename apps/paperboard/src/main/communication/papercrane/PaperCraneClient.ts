import { WebSocket } from "ws";
import { logger } from "../../../../papercrane/logger";
import { EventEmitter } from "events";
import * as path from "path";
import * as crypto from "crypto";
import {
    startPaperCraneServer,
    PanelManifest,
    ServerInstance,
    DEFAULT_PORT,
} from "../../../../papercrane";
import { PROTOCOL_VERSION } from "../../../../papercrane/protocol";
import { readCraneHandshake } from "../../../../papercrane/handshake";
import { getLocalDir } from "../../../../papercrane/paths";
import { resolveRegistryUrl } from "../../../../papercrane/util";
import {
    peerCertPem,
    pinnedRequest,
    pinnedTlsOptions,
    type PinnedRequestInit,
    type PinnedResponse,
} from "../../../../papercrane/pinnedTls";
import type { TLSSocket } from "tls";
import { pinnableWebSocket } from "../../../../papercrane/pinnableWebSocket";

export type RpcParams = Record<string, unknown>;

export interface ProgressPayload {
    stage:
        | "starting"
        | "checking"
        | "downloading"
        | "verifying"
        | "extracting"
        | "completed"
        | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export interface CraneSystemInfo {
    service?: string;
    version?: string;
    pid?: number;
    hostname: string;
    os: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
    ip?: string;
    username?: string;
}

export interface PackageInstallInfo {
    name?: string;
    version?: string;
    installedAt?: string;
}

// same reader as every other consumer of the handshake file
// (papercrane/handshake.ts) — validation lives there
const readCraneJson = readCraneHandshake;

async function probeAlive(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(600),
        });
        return res.ok;
    } catch (err) {
        logger.debug(`[PaperCraneClient] daemon probe on ${port} failed:`, err);
        return false;
    }
}

function isLoopback(host: string): boolean {
    return host === "localhost" || host === "127.0.0.1";
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

export class PaperCraneClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private host: string = "localhost";
    private port: number = DEFAULT_PORT;
    private token?: string;
    // remote daemon certificate: pinned after pairing, captured during it
    private cert?: string;
    private trustOnFirstUse = false;
    private embeddedServer: ServerInstance | null = null;
    private isConnected: boolean = false;
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
    private readonly heartbeatMs: number;
    private readonly reconnectBaseMs: number;
    private readonly reconnectMaxMs: number;

    public getEmbeddedServer(): ServerInstance | null {
        return this.embeddedServer;
    }

    private progressListeners = new Map<
        string,
        (payload: ProgressPayload) => void
    >();

    constructor(options: PaperCraneClientOptions = {}) {
        super();
        this.heartbeatMs = options.heartbeatMs ?? 15_000;
        this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
        this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
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
        return pinnedRequest(`https://${this.host}:${this.port}${cleanSub}`, this.cert, init);
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

        const isLocal = isLoopback(host);
        if (!isLocal && !cert && !this.trustOnFirstUse) {
            const error = this.missingCertMessage();
            this.lastError = error;
            this.emit("status", this.getStatus());
            throw new Error(error);
        }

        // trust handshake only after health probe, else restart embedded
        if (isLocal && !token) {
            const stored = readCraneJson();
            if (stored && (await probeAlive(stored.port))) {
                this.port = stored.port;
                this.token = stored.token;
            } else {
                try {
                    if (this.embeddedServer?.stop) {
                        this.embeddedServer.stop();
                        this.embeddedServer = null;
                    }
                    // reuse previous token so authorized-token store stays stable
                    const freshToken =
                        stored?.token ??
                        "pc_" + crypto.randomBytes(24).toString("hex");
                    this.embeddedServer = await startPaperCraneServer({
                        port: 0,
                        host: "127.0.0.1",
                        headless: true,
                        staticToken: freshToken,
                        remotesFile: path.join(
                            getLocalDir(),
                            "paired_computers.json",
                        ),
                    });
                    if (this.embeddedServer?.port) {
                        this.port = this.embeddedServer.port;
                        this.token = freshToken;
                    }
                    await new Promise((r) => setTimeout(r, 150));
                } catch (err) {
                    console.warn(
                        "[PaperCraneClient] failed to start embedded server:",
                        err instanceof Error ? err.message : err,
                    );
                }
            }
            if (gen !== this.generation) throw new Error("Connection attempt was superseded");
        }

        return new Promise((resolve, reject) => {
            const Socket = pinnableWebSocket();
            const ws = isLocal
                ? new Socket(`ws://${host}:${this.port}`)
                : new Socket(
                      `wss://${host}:${this.port}`,
                      cert ? pinnedTlsOptions(cert) : { rejectUnauthorized: false },
                  );
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

            ws.on("open", async () => {
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
            });

            ws.on("error", (err: Error) => {
                if (!current()) return;
                fail(
                    `Cannot connect to the Paperboard Server daemon at ${host}:${this.port}` +
                        (err?.message ? `: ${err.message}` : ""),
                );
                this.emit("status", this.getStatus());
            });

            ws.on("message", (raw: unknown) => {
                try {
                    const text = (raw as Buffer).toString("utf8");
                    const msg = JSON.parse(text) as {
                        type?: string;
                        id?: number;
                        error?: string;
                        result?: unknown;
                        event?: string;
                        payload?: Record<string, unknown>;
                    };
                    if (msg.type === "response") {
                        const handler =
                            msg.id !== undefined
                                ? this.pendingRequests.get(msg.id)
                                : undefined;
                        if (handler && handler.socket === ws) {
                            this.pendingRequests.delete(msg.id as number);
                            clearTimeout(handler.timer);
                            if (msg.error)
                                handler.reject(new DaemonRefusal(msg.error));
                            else handler.resolve(msg.result);
                        }
                    } else if (msg.type === "event") {
                        this.handlePushEvent(
                            msg.event ?? "",
                            msg.payload ?? {},
                        );
                    }
                } catch (err) { logger.debug("[PaperCraneClient.ts] op failed:", err) }
            });

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

    // set when the daemon refused the credential; retrying cannot help
    private credentialRejected = false;

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

    private awaitingPong = false;

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
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.credentialRejected = false;
        if (this.ws) {
            try {
                this.ws.close();
            } catch (err) { logger.debug("[PaperCraneClient.ts] op failed:", err) }
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
        try {
            this.embeddedServer?.stop?.();
        } catch (err) { logger.debug("[PaperCraneClient.ts] op failed:", err) }
        this.embeddedServer = null;
    }

    // NOTE: the client no longer tracks terminal/process streams — panels
    // own their streams through PaperAPI's transport (refcounted attach,
    // reconnect replay there). The dispatcher below only serves progress
    // events for the updater's package downloads.
    private handlePushEvent(
        event: string,
        payload: Record<string, unknown>,
    ) {
        // terminal/process push events are owned by PaperAPI's transport;
        // this client only dispatches updater progress
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
            throw new Error(`Cannot connect to the Paperboard Server daemon at ${this.host}:${this.port}`);
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

    public async pair(
        code: string,
        clientName?: string,
    ): Promise<{
        success: boolean;
        token: string;
        hostname: string;
        os: string;
        osVersion?: string;
        distroId?: string;
        distroName?: string;
        arch: string;
    }> {
        const res = await this.call<{
            success: boolean;
            token: string;
            hostname: string;
            os: string;
            osVersion?: string;
            distroId?: string;
            distroName?: string;
            arch: string;
        }>("auth:pair", { code, clientName });
        if (res.token) {
            this.token = res.token;
        }
        return res;
    }

    public async getPackageIndex(): Promise<Record<string, PackageInstallInfo>> {
        const res = await this.call<{
            index: Record<string, PackageInstallInfo>;
        }>("package:getIndex");
        return res.index;
    }


    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: (payload: ProgressPayload) => void,
        expectedSha256?: string,
    ): Promise<string> {
        this.progressListeners.set(downloadId, onProgress);
        try {
            const res = await this.call<{ path: string }>("package:download", { packageName, downloadId, sha256: expectedSha256 });
            return res.path;
        } finally {
            this.progressListeners.delete(downloadId);
        }
    }

    public async listPanels(): Promise<PanelManifest[]> {
        const res = await this.call<{ panels?: PanelManifest[] }>("panel:list");
        return res.panels || [];
    }

    public async installPanel(panelId: string, expected: { version?: string; sha256?: string }): Promise<PanelManifest> {
        const res = await this.call<{ panel?: PanelManifest }>("panel:install", {
            panelId,
            version: expected.version,
            sha256: expected.sha256,
            // TODO(remove after v0.2): daemons before registry-resolved
            // installs require this; current daemons ignore it
            downloadUrl: `${resolveRegistryUrl()}/panel/${encodeURIComponent(panelId)}/download`,
        });
        if (!res.panel) throw new Error(`Panel install failed for ${panelId}`);
        return res.panel;
    }


    // Config operations
    public async getConfig<T = Record<string, unknown>>(
        id: string,
    ): Promise<T | null> {
        const res = await this.call<{ data: T | null }>("config:get", { id });
        return res.data;
    }

    public async setConfig(id: string, data: unknown): Promise<boolean> {
        const res = await this.call<{ success: boolean }>("config:set", { id, data });
        return res.success;
    }

    // Self-update: tells the PaperCrane daemon to download and replace its own binary
    public async updateCrane(
        version: string,
        downloadUrl: string,
        sha256: string,
        signature: string,
    ): Promise<void> {
        await this.call("system:update", { version, downloadUrl, sha256, signature });
    }

    // System info

    public async getSystemInfo(): Promise<CraneSystemInfo | null> {
        try {
            return await this.call<CraneSystemInfo>("system:info");
        } catch (err) {
            logger.debug("[PaperCraneClient] getSystemInfo failed, caller treats null as unknown:", err);
            return null;
        }
    }
}

export const paperCraneClient = new PaperCraneClient();
export default paperCraneClient;
