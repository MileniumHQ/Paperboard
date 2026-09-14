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

export interface TargetStatus {
    connected: boolean;
    isRemote: boolean;
    host: string;
    port: number;
    error?: string;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export class PaperCraneClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private host: string = "localhost";
    private port: number = DEFAULT_PORT;
    private token?: string;
    private embeddedServer: ServerInstance | null = null;
    private isConnected: boolean = false;
    private requestIdCounter = 1;
    private pendingRequests = new Map<
        number,
        {
            resolve: (val: unknown) => void;
            reject: (err: Error) => void;
            timer: NodeJS.Timeout;
        }
    >();
    // single-flight guard so concurrent calls don't race reentrant connects
    private connectingPromise: Promise<TargetStatus> | null = null;

    public getEmbeddedServer(): ServerInstance | null {
        return this.embeddedServer;
    }

    private progressListeners = new Map<
        string,
        (payload: ProgressPayload) => void
    >();

    constructor() {
        super();
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

    public getHttpUrl(subpath: string = ""): string {
        const cleanSub = subpath.startsWith("/") ? subpath : `/${subpath}`;
        return `http://${this.host}:${this.port}${cleanSub}`;
    }

    public getStatus(): TargetStatus {
        const isRemote = this.host !== "localhost" && this.host !== "127.0.0.1";
        return {
            connected: this.isConnected,
            isRemote,
            host: this.host,
            port: this.port,
        };
    }

    public async connect(
        host = "127.0.0.1",
        port?: number,
        token?: string,
    ): Promise<TargetStatus> {
        if (this.connectingPromise) return this.connectingPromise;

        const doConnect = async (): Promise<TargetStatus> => {
            this.disconnect();
            this.host = host;
            if (port) this.port = port;
            this.token = token;

            const isLocal = host === "localhost" || host === "127.0.0.1";

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
            }

            return new Promise((resolve, reject) => {
                const wsUrl = `ws://${host}:${this.port}`;
                const ws = new WebSocket(wsUrl);
                let hasResolved = false;

                ws.on("open", () => {
                    this.ws = ws;
                    this.isConnected = true;
                    if (!hasResolved) {
                        hasResolved = true;
                        this.emit("status", this.getStatus());
                        resolve(this.getStatus());
                    }
                });

                ws.on("error", (err: Error) => {
                    this.emit("status", {
                        ...this.getStatus(),
                        error: err?.message || "Connection failed",
                    });
                    // reject pre-open so callers see real failures
                    if (!hasResolved) {
                        hasResolved = true;
                        this.isConnected = false;
                        reject(
                            new Error(
                                `Cannot connect to the Paperboard Server daemon at ${host}:${this.port}` +
                                    (err?.message ? `: ${err.message}` : ""),
                            ),
                        );
                    }
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
                            if (handler) {
                                this.pendingRequests.delete(msg.id as number);
                                clearTimeout(handler.timer);
                                if (msg.error)
                                    handler.reject(new Error(msg.error));
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

                ws.on("close", () => {
                    this.isConnected = false;
                    this.ws = null;
                    for (const pending of this.pendingRequests.values()) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error("Paperboard Server connection closed"));
                    }
                    this.pendingRequests.clear();
                    this.emit("status", this.getStatus());
                });
            });
        };

        this.connectingPromise = doConnect().finally(() => {
            this.connectingPromise = null;
        });
        return this.connectingPromise;
    }

    public disconnect() {
        if (this.ws) {
            try {
                this.ws.close();
            } catch (err) { logger.debug("[PaperCraneClient.ts] op failed:", err) }
            this.ws = null;
        }
        this.isConnected = false;
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
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect(this.host, this.port, this.token);
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Cannot connect to the Paperboard Server daemon at ${this.host}:${this.port}`);
        }

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
            });
            this.ws!.send(JSON.stringify({ id, action, params: finalParams }));
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

    public async installPanel(panelId: string, downloadUrl: string, expectedSha256?: string): Promise<PanelManifest> {
        const res = await this.call<{ panel?: PanelManifest }>("panel:install", { panelId, downloadUrl, sha256: expectedSha256 });
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
        sha256?: string,
    ): Promise<void> {
        await this.call("system:update", { version, downloadUrl, sha256 });
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
