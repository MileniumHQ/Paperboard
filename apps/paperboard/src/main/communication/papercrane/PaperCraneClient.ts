import { WebSocket } from "ws";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
    startPaperCraneServer,
    PanelManifest,
    ServerInstance,
    DEFAULT_PORT,
} from "../../../../papercrane";
import { getLocalDir } from "../../../../papercrane/paths";

// Shape of an RPC params record sent over the WebSocket protocol.
export type RpcParams = Record<string, unknown>;

// Progress payload pushed via the "progress" event during downloads.
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

// System information reported by the PaperCrane daemon (system:info).
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

// Per-package entry of the daemon's installed-package index.
export interface PackageInstallInfo {
    name?: string;
    version?: string;
    installedAt?: string;
}

// Local daemon discovery record written by every crane instance.
interface CraneHandshake {
    port: number;
    token: string;
}

function readCraneJson(): CraneHandshake | null {
    try {
        const file = path.join(getLocalDir(), "crane.json");
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        if (typeof raw?.port === "number" && typeof raw?.token === "string")
            return raw;
    } catch {}
    return null;
}

async function probeAlive(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(600),
        });
        return res.ok;
    } catch {
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

// WebSocket client connecting to a local or remote PaperCrane agent daemon
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
    // Single-flight guard so concurrent calls don't race reentrant connects
    private connectingPromise: Promise<TargetStatus> | null = null;

    public getEmbeddedServer(): ServerInstance | null {
        return this.embeddedServer;
    }

    private termDataListeners = new Map<string, (data: string) => void>();
    private termExitListeners = new Map<string, (exitCode: number) => void>();
    private processDataListeners = new Map<
        string,
        (data: string, stream: "stdout" | "stderr") => void
    >();
    private processExitListeners = new Map<string, (exitCode: number) => void>();
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
        // Single-flight: concurrent callers share one connect attempt
        if (this.connectingPromise) return this.connectingPromise;

        const doConnect = async (): Promise<TargetStatus> => {
            this.disconnect();
            this.host = host;
            if (port) this.port = port;
            this.token = token;

            const isLocal = host === "localhost" || host === "127.0.0.1";

            // Trust crane.json only after a health probe; otherwise restart
            // the embedded instance
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
                        // Reuse previous token so the authorized-token store
                        // stays stable across launches
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
                    // Reject pre-open so callers see real failures instead
                    // of a resolved-but-disconnected status
                    if (!hasResolved) {
                        hasResolved = true;
                        this.isConnected = false;
                        reject(
                            new Error(
                                `Cannot connect to PaperCrane at ${host}:${this.port}` +
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
                    } catch {}
                });

                ws.on("close", () => {
                    this.isConnected = false;
                    this.ws = null;
                    for (const pending of this.pendingRequests.values()) {
                        clearTimeout(pending.timer);
                        pending.reject(new Error("PaperCrane connection closed"));
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
            } catch {}
            this.ws = null;
        }
        this.isConnected = false;
    }

    // Separate from disconnect() so transient reconnects never kill running
    // game servers
    public stopEmbeddedServer(): void {
        try {
            this.embeddedServer?.stop?.();
        } catch {}
        this.embeddedServer = null;
    }

    // Handles pushed streaming and progress events from PaperCrane
    private handlePushEvent(
        event: string,
        payload: Record<string, unknown>,
    ) {
        const id = payload.id as string;
        if (event === "term:data") {
            this.termDataListeners.get(id)?.(payload.data as string);
        } else if (event === "term:exit") {
            this.termExitListeners.get(id)?.(payload.exitCode as number);
            this.termDataListeners.delete(id);
            this.termExitListeners.delete(id);
        } else if (event === "process:data") {
            this.processDataListeners.get(id)?.(
                payload.data as string,
                payload.stream as "stdout" | "stderr",
            );
        } else if (event === "process:exit") {
            this.processExitListeners.get(id)?.(payload.exitCode as number);
            this.processDataListeners.delete(id);
            this.processExitListeners.delete(id);
        } else if (event === "progress") {
            this.progressListeners.get(payload.downloadId as string)?.(
                payload as unknown as ProgressPayload,
            );
        }
    }

    // Sends an RPC request to the PaperCrane WebSocket server with a timeout
    public async call<T = unknown>(
        action: string,
        params: RpcParams = {},
        timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
    ): Promise<T> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect(this.host, this.port, this.token);
        }
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Cannot connect to PaperCrane at ${this.host}:${this.port}`);
        }

        const id = this.requestIdCounter++;
        const finalParams = this.token ? { token: this.token, ...params } : params;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`PaperCrane RPC '${action}' timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pendingRequests.set(id, {
                resolve: resolve as (val: unknown) => void,
                reject,
                timer,
            });
            this.ws!.send(JSON.stringify({ id, action, params: finalParams }));
        });
    }

    // Authenticates and pairs with a remote PaperCrane instance
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

    // Terminal methods
    public async createTerminal(
        id: string,
        cols: number,
        rows: number,
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void> {
        if (onData) this.termDataListeners.set(id, onData);
        if (onExit) this.termExitListeners.set(id, onExit);
        await this.call("term:create", { id, cols, rows, cwd, env });
    }

    public writeTerminal(id: string, data: string): void {
        this.call("term:write", { id, data }).catch(() => {});
    }

    public resizeTerminal(id: string, cols: number, rows: number): void {
        this.call("term:resize", { id, cols, rows }).catch(() => {});
    }

    public destroyTerminal(id: string): void {
        this.termDataListeners.delete(id);
        this.termExitListeners.delete(id);
        this.call("term:destroy", { id }).catch(() => {});
    }

    public async isTerminalRunning(id: string): Promise<boolean> {
        const res = await this.call<{ running: boolean }>("term:exists", { id });
        return Boolean(res?.running);
    }

    // Process methods
    public async startProcess(
        id: string,
        command: string,
        args: string[] = [],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<void> {
        this.processDataListeners.set(id, (data, stream) => {
            onData?.(data);
            if (stream === "stdout") onStdout?.(data);
            if (stream === "stderr") onStderr?.(data);
        });
        if (onExit) this.processExitListeners.set(id, onExit);
        await this.call("process:run", { id, command, args, cwd, env });
    }

    public writeProcess(id: string, data: string): void {
        this.call("process:write", { id, data }).catch(() => {});
    }

    public killProcess(id: string, signal: string = "SIGTERM"): void {
        this.processDataListeners.delete(id);
        this.processExitListeners.delete(id);
        this.call("process:kill", { id, signal }).catch(() => {});
    }

    public async isProcessRunning(id: string): Promise<boolean> {
        const res = await this.call<{ running: boolean }>("process:exists", { id });
        return Boolean(res?.running);
    }

    public async attachProcess(
        id: string,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
        onExit?: (exitCode: number) => void,
    ): Promise<boolean> {
        this.processDataListeners.set(id, (data, stream) => {
            onData?.(data);
            if (stream === "stdout") onStdout?.(data);
            if (stream === "stderr") onStderr?.(data);
        });
        if (onExit) this.processExitListeners.set(id, onExit);
        const res = await this.call<{ success: boolean }>("process:attach", { id });
        return Boolean(res?.success);
    }

    public async runProcess(
        id: string,
        command: string,
        args: string[] = [],
        cwd?: string,
        env?: Record<string, string>,
        onData?: (data: string) => void,
        onStdout?: (data: string) => void,
        onStderr?: (data: string) => void,
    ): Promise<{ exitCode: number }> {
        return new Promise<{ exitCode: number }>((resolve, reject) => {
            this.processDataListeners.set(id, (data, stream) => {
                onData?.(data);
                if (stream === "stdout") onStdout?.(data);
                if (stream === "stderr") onStderr?.(data);
            });
            this.processExitListeners.set(id, (exitCode) => resolve({ exitCode }));
            this.call("process:run", { id, command, args, cwd, env }).catch(reject);
        });
    }

    // File operations
    public async getFilePath(targetPath: string, appId?: string): Promise<string> {
        const res = await this.call<{ path: string }>("file:getPath", { targetPath, appId });
        return res.path;
    }

    public async fileExists(targetPath: string, appId?: string): Promise<boolean> {
        const res = await this.call<{ exists: boolean }>("file:exists", { targetPath, appId });
        return res.exists;
    }

    public async writeFile(targetPath: string, content: string, appId?: string): Promise<string> {
        const res = await this.call<{ path: string }>("file:write", { targetPath, content, appId });
        return res.path;
    }

    public async readFile(targetPath: string, appId?: string): Promise<string | null> {
        const res = await this.call<{ content: string | null }>("file:read", { targetPath, appId });
        return res.content;
    }

    public async clearFiles(appId?: string): Promise<boolean> {
        const res = await this.call<{ success: boolean }>("file:clear", { appId });
        return res.success;
    }

    public async downloadFile(
        url: string,
        targetPath: string,
        appId: string | undefined,
        downloadId: string,
        options: {
            sha1?: string;
            sha256?: string;
            checksum?: { algorithm: string; value: string };
        },
        onProgress: (payload: ProgressPayload) => void,
    ): Promise<string> {
        this.progressListeners.set(downloadId, onProgress);
        try {
            const res = await this.call<{ path: string }>("file:download", {
                url,
                targetPath,
                appId,
                downloadId,
                options,
            });
            return res.path;
        } finally {
            this.progressListeners.delete(downloadId);
        }
    }

    // Package operations
    public async isPackageInstalled(packageName: string, version?: string): Promise<boolean> {
        const res = await this.call<{ installed: boolean }>("package:isInstalled", { packageName, version });
        return res.installed;
    }

    public async getPackageIndex(): Promise<Record<string, PackageInstallInfo>> {
        const res = await this.call<{
            index: Record<string, PackageInstallInfo>;
        }>("package:getIndex");
        return res.index;
    }

    public async getPackagePath(packageName: string): Promise<string> {
        const res = await this.call<{ path: string }>("package:getPath", { packageName });
        return res.path;
    }

    public async downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: (payload: ProgressPayload) => void,
    ): Promise<string> {
        this.progressListeners.set(downloadId, onProgress);
        try {
            const res = await this.call<{ path: string }>("package:download", { packageName, downloadId });
            return res.path;
        } finally {
            this.progressListeners.delete(downloadId);
        }
    }

    // Panel operations
    public async listPanels(): Promise<PanelManifest[]> {
        const res = await this.call<{ panels?: PanelManifest[] }>("panel:list");
        return res.panels || [];
    }

    public async installPanel(panelId: string, downloadUrl: string, expectedSha256?: string): Promise<PanelManifest> {
        const res = await this.call<{ panel?: PanelManifest }>("panel:install", { panelId, downloadUrl, sha256: expectedSha256 });
        if (!res.panel) throw new Error(`Panel install failed for ${panelId}`);
        return res.panel;
    }

    public async uninstallPanel(panelId: string): Promise<boolean> {
        const res = await this.call<{ success?: boolean }>("panel:uninstall", { panelId });
        return res.success ?? true;
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
    public async getIP(): Promise<string> {
        // The daemon reports its own LAN IP — same source as system:info.
        const res = await this.call<{ ip: string }>("system:ip");
        return res.ip;
    }

    public async getSystemInfo(): Promise<CraneSystemInfo | null> {
        try {
            return await this.call<CraneSystemInfo>("system:info");
        } catch {
            return null;
        }
    }
}

export const paperCraneClient = new PaperCraneClient();
export default paperCraneClient;
