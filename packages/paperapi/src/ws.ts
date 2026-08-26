// WebSocket transport to a PaperCrane daemon; bound to one computer forever,
// remote frames ride a tunnel envelope or fail loudly

import type * as fsType from "fs";

import { debug, debugErr } from "./debug";

export interface TransportOptions {
    port?: number;
    token?: string;
    /** Immutable computer scope ("local" or a paired id); defaults ambient. */
    computerId?: string;
    /** Node-only: explicit handshake file instead of the default location. */
    craneJsonPath?: string;
}

type Listener = (payload: any) => void;

interface Pending {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 5_000;

// Computer scope implied by the hostname prefix of the embedding document
export function ambientScope(): string {
    if (typeof location !== "undefined") {
        const host = location.hostname || "";
        const dot = host.indexOf(".");
        if (dot > 0) return host.slice(0, dot);
    }
    return "local";
}

// Web Crypto first (bundlers shim node:crypto away in browser builds)
async function randomTunnelId(): Promise<string> {
    const c = (globalThis as any).crypto;
    if (c?.getRandomValues) {
        const bytes = new Uint8Array(6);
        c.getRandomValues(bytes);
        return `t-${Array.from(bytes, (b) =>
            b.toString(16).padStart(2, "0"),
        ).join("")}`;
    }
    const specifier = ["n", "od", "e:c", "ryp", "t", "o"].join("");
    const mod = await import(/* @vite-ignore */ specifier);
    return `t-${mod.randomBytes(6).toString("hex")}`;
}

// Non-static specifier so bundlers don't fold it into browser builds
async function nodeBuiltin(name: string): Promise<any> {
    const specifier = ["nod", "e:"].join("") + name;
    return import(/* @vite-ignore */ specifier);
}

function defaultCraneJsonPath(pathMod: any): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return pathMod.join(
        process.env.PAPERBOARD_DIR || pathMod.join(home, ".paperboard"),
        "local",
        "crane.json",
    );
}

// Native WebSocket preferred; ws package fallback keeps bundlers uninvolved
async function getWebSocketImpl(): Promise<any> {
    const g = globalThis as any;
    if (typeof g.WebSocket !== "undefined") {
            // Adapt native events to the ws-package shape
        return class NativeAdapter {
            private _ws: WebSocket;
            constructor(url: string) {
                this._ws = new g.WebSocket(url);
            }
            get readyState() {
                return this._ws.readyState;
            }
            send(data: string) {
                this._ws.send(data);
            }
            close() {
                this._ws.close();
            }
            on(event: string, cb: (arg?: any) => void) {
                if (event === "message") {
                    this._ws.addEventListener("message", (e) =>
                        cb((e as MessageEvent).data),
                    );
                } else {
                    this._ws.addEventListener(event, () => cb());
                }
            }
        };
    }
    const specifier = ["w", "s"].join("");
    const mod = await import(/* @vite-ignore */ specifier);
    return mod.default ?? mod.WebSocket ?? mod;
}

export class CraneTransport {
    public readonly computerId: string;
    private ws: any = null;
    private port: number | null = null;
    private token: string | null = null;
    private opts: TransportOptions = {};
    // Supplies LOCAL daemon credentials for embedders like the Electron shell
    public credentialProvider: (() => Promise<{
        port: number;
        token: string;
    }>) | null = null;
    private pending = new Map<number, Pending>();
    private listeners = new Map<string, Set<Listener>>();
    private requestId = 1;
    private connecting: Promise<void> | null = null;
    private reconnectAttempts = 0;
    private closedByUser = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Subscriptions replayed after reconnects
    private attachedTerminals = new Set<string>();
    private attachedProcesses = new Set<string>();
    // Live tunnel to this.computerId; null means remote frames must fail
    private tunnelId: string | null = null;
    // Node runtime detection
    private isNode =
        typeof window === "undefined" &&
        typeof process !== "undefined" &&
        !!(process as any).versions?.node;

    public statusListeners = new Set<Listener>();

    constructor(opts: TransportOptions = {}) {
        this.opts = opts;
        this.computerId = opts.computerId || ambientScope();
    }

    // ── Bootstrap ───────────────────────────────────────────────────────────

    private async resolveCredentials(): Promise<void> {
        if (this.opts.port && this.opts.token) {
            this.port = this.opts.port;
            this.token = this.opts.token;
            return;
        }

        if (this.credentialProvider) {
            const creds = await this.credentialProvider();
            this.port = creds.port;
            this.token = creds.token;
            return;
        }

        if (!this.isNode) {
            // Browser: prefer credentials injected by the host at serve time
            // (scoped to this document's computer); fall back to /__crane.
            const injected = (globalThis as any).__PAPERBOARD_CRANE;
            if (injected?.port && injected?.token) {
                if (injected.computerId !== this.computerId) {
                    throw new Error(
                        `Paperboard host served credentials for "${injected.computerId}" but this panel is scoped to "${this.computerId}"`,
                    );
                }
                this.port = injected.port;
                this.token = injected.token;
                return;
            }
            const res = await fetch("/__crane");
            if (!res.ok) throw new Error(`Paperboard host unavailable (${res.status})`);
            const creds = await res.json();
            if (creds.computerId !== this.computerId) {
                throw new Error(
                    `Paperboard host served credentials for "${creds.computerId}" but this panel is scoped to "${this.computerId}"`,
                );
            }
            this.port = creds.port;
            this.token = creds.token;
            return;
        }

        // Node reads the local handshake file; always local-scoped
        if (this.computerId !== "local") {
            throw new Error(
                `Transport scoped to "${this.computerId}" requires explicit port/token credentials in Node`,
            );
        }
        const pathMod = await nodeBuiltin("path");
        const fsMod: typeof fsType = await nodeBuiltin("fs");
        const file = this.opts.craneJsonPath || defaultCraneJsonPath(pathMod);
        const raw = JSON.parse(fsMod.readFileSync(file, "utf8"));
        this.port = raw.port;
        this.token = raw.token;
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    public onStatus(cb: Listener): void {
        this.statusListeners.add(cb);
    }

    private emitStatus(connected: boolean, error?: string): void {
        for (const cb of this.statusListeners) cb({ connected, error });
    }

    public isConnected(): boolean {
        return !!this.ws && this.ws.readyState === 1;
    }

    // Remote scope needs a live tunnel, not just a socket
    private isRoutingLive(): boolean {
        return this.computerId === "local" || !!this.tunnelId;
    }

    public async ensureConnected(): Promise<void> {
        if (this.isConnected() && this.isRoutingLive()) return;
        if (this.connecting) return this.connecting;
        this.connecting = this.open().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    private async open(): Promise<void> {
        await this.resolveCredentials();

        // Reuse a live socket when only the tunnel is missing
        if (!this.isConnected()) {
            const Ws = await getWebSocketImpl();
            await new Promise<void>((resolve, reject) => {
                const ws = new Ws(`ws://127.0.0.1:${this.port}`);
                let settled = false;

                ws.on("open", () => {
                    settled = true;
                    this.ws = ws;
                    this.reconnectAttempts = 0;
                    this.emitStatus(true);
                    this.afterOpen();
                    resolve();
                });

                ws.on("error", (err: Error) => {
                    if (!settled) {
                        settled = true;
                        reject(err);
                    }
                });

                ws.on("message", (raw: any) => {
                    try {
                        const text =
                            typeof raw === "string" ? raw : raw.toString("utf8");
                        this.handleMessage(text);
                    } catch (err) { debugErr("message handler", err); }
                });

                ws.on("close", () => {
                    this.ws = null;
                    // Tunnel died with the socket; open() re-establishes it
                    this.tunnelId = null;
                    this.emitStatus(false);
                    this.rejectAllPending("PaperCrane connection closed");
                    if (!this.closedByUser) this.scheduleReconnect();
                });
            });
        }

        // Remote scope requires a live tunnel before "connected"
        if (this.computerId !== "local" && !this.tunnelId) {
            await this.openTunnel(this.computerId);
        }

        // Replay stream subscriptions owned by this client
        await this.resubscribe();
    }

    private afterOpen(): void {}

    private scheduleReconnect(): void {
        const delay = Math.min(
            RECONNECT_MAX_MS,
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.closedByUser) return;
            this.open().catch(() => this.scheduleReconnect());
        }, delay);
    }

    /** Stops the transport for good; safe to call repeatedly. */
    public close(): void {
        this.closedByUser = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
        this.tunnelId = null;
        this.rejectAllPending("PaperCrane transport closed");
    }

    private async openTunnel(computerId: string): Promise<void> {
        const id = await randomTunnelId();
        debug(`target=${computerId} opening tunnel ${id}`);
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error("Tunnel open timed out")),
                    5_000,
                );
                const listener = (msg: any) => {
                    try {
                        const parsed = JSON.parse(msg);
                        if (
                            (parsed.type === "tunnel-open" ||
                                parsed.type === "tunnel-closed") &&
                            parsed.id === id
                        ) {
                            clearTimeout(timeout);
                            this.removeMessageListener(listener);
                            if (parsed.type === "tunnel-open") {
                                resolve();
                            } else {
                                reject(
                                    new Error(
                                        `Remote tunnel failed: ${parsed.reason ?? "closed"}`,
                                    ),
                                );
                            }
                        }
                    } catch (err) { debugErr("tunnel handshake listener", err); }
                };
                this.addRawListener(listener);
                this.rawSend({
                    type: "remote:open",
                    id,
                    computerId,
                });
            });
        } catch (err: any) {
            debug(`target=${computerId} tunnel open FAILED: ${err?.message}`);
            throw err;
        }
        this.tunnelId = id;
        debug(`target=${computerId} tunnel ${id} open`);
    }

    // ── Raw messaging ───────────────────────────────────────────────────────

    private rawListeners = new Set<(msg: string) => void>();

    private addRawListener(cb: (msg: string) => void): void {
        this.rawListeners.add(cb);
    }

    private removeMessageListener(cb: (msg: string) => void): void {
        this.rawListeners.delete(cb);
    }

    private rawSend(obj: unknown): void {
        this.ws?.send(JSON.stringify(obj));
    }

    private handleMessage(text: string): void {
        // Raw listeners see everything first (tunnel handshake waits here)
        for (const cb of this.rawListeners) {
            try {
                cb(text);
            } catch (err) { debugErr("raw listener", err); }
        }

        let msg: any;
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }

        // Unwrap tunneled payloads into the normal pipeline
        if (msg.type === "tunnel" && typeof msg.payload === "string") {
            try {
                msg = JSON.parse(msg.payload);
                debug(`target=${this.computerId} <- tunnel frame id=${msg.id ?? ""} type=${msg.type}`);
            } catch {
                return;
            }
        }

        // Upstream leg dropped: rebuild tunnel and resubscribe
        if (msg.type === "tunnel-closed" && msg.id === this.tunnelId) {
            this.tunnelId = null;
            const reopen = async () => {
                if (this.computerId === "local") return;
                await this.openTunnel(this.computerId);
                await this.resubscribe();
            };
            reopen().catch((err) => {
                // Leave tunnel down; socket is healthy, next ensureConnected retries
                debug(`target=${this.computerId} tunnel reopen failed: ${err?.message}`);
            });
            return;
        }

        if (msg.type === "tunnel-open" && msg.id !== this.tunnelId) {
            // Stale handshake for an abandoned tunnel attempt
            return;
        }

        if (msg.type === "response") {
            const p = this.pending.get(msg.id);
            if (p) {
                this.pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.error) p.reject(new Error(msg.error));
                else p.resolve(msg.result);
            }
        } else if (msg.type === "event") {
            this.dispatch(msg.event, msg.payload);
        }
    }

    private dispatch(event: string, payload: any): void {
        const set = this.listeners.get(event);
        if (set) for (const cb of set) cb(payload);
    }

    private rejectAllPending(reason: string): void {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        }
        this.pending.clear();
    }

    // ── Public API used by the namespace router ─────────────────────────────

    public async call(action: string, params: Record<string, unknown> = {}, timeoutMs: number | null = 30_000): Promise<any> {
        await this.ensureConnected();

        const id = this.requestId++;
        const finalParams = { token: this.token, ...params };
        return new Promise((resolve, reject) => {
            // null timeoutMs waits indefinitely (long-running operations)
            const timer =
                timeoutMs === null
                    ? undefined
                    : setTimeout(() => {
                          this.pending.delete(id);
                          reject(new Error(`PaperCrane '${action}' timed out`));
                      }, timeoutMs);
            const entry = { resolve, reject, timer: timer as any };
            this.pending.set(id, entry);
            try {
                if (this.isLocalOnlyChannel(action, finalParams)) {
                    // Host-local state always executes on the local daemon
                    this.ws.send(JSON.stringify({ id, action, params: finalParams }));
                } else {
                    this.frame({ id, action, params: finalParams });
                }
            } catch (err) {
                this.pending.delete(id);
                clearTimeout(timer as any);
                reject(err as Error);
            }
        });
    }

    public subscribeEvent(event: string, cb: Listener): void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(cb);
    }

    public unsubscribeEvent(event: string, cb?: Listener): void {
        if (!cb) this.listeners.delete(event);
        else this.listeners.get(event)?.delete(cb);
    }

    // Fan-out registry for translated channels sharing one upstream event
    private sourceSubs = new Map<
        string,
        { count: number; cbs: Set<Listener> }
    >();

    public subscribeSource(
        source: string,
        cb: Listener,
    ): () => void {
        let entry = this.sourceSubs.get(source);
        if (!entry) {
            entry = { count: 0, cbs: new Set() };
            this.sourceSubs.set(source, entry);
            this.subscribeEvent(source, (payload) => {
                for (const inner of entry!.cbs) inner(payload);
            });
        }
        entry.count++;
        entry.cbs.add(cb);
        return () => {
            entry!.cbs.delete(cb);
            entry!.count--;
            if (entry!.count <= 0) {
                this.unsubscribeEvent(source);
                this.sourceSubs.delete(source);
            }
        };
    }

    public unsubscribeSource(
        source: string,
        cb: Listener,
    ): void {
        const entry = this.sourceSubs.get(source);
        if (!entry || !entry.cbs.has(cb)) return;
        entry.cbs.delete(cb);
        entry.count--;
        if (entry.count <= 0) {
            this.unsubscribeEvent(source);
            this.sourceSubs.delete(source);
        }
    }

    public trackTerminal(id: string): void {
        this.attachedTerminals.add(id);
    }

    public untrackTerminal(id: string): void {
        this.attachedTerminals.delete(id);
    }

    public trackProcess(id: string): void {
        this.attachedProcesses.add(id);
    }

    public untrackProcess(id: string): void {
        this.attachedProcesses.delete(id);
    }

    // Replays stream attachments after a reconnect
    private async resubscribe(): Promise<void> {
        for (const id of this.attachedTerminals) {
            this.call("term:attach", { id }).catch((err) => debugErr(`term:attach ${id}`, err));
        }
        for (const id of this.attachedProcesses) {
            this.call("process:attach", { id }).catch((err) => debugErr(`process:attach ${id}`, err));
        }
    }

    /** True when frames should bypass an active tunnel (host-local state). */
    private isLocalOnlyChannel(action: string, params: any): boolean {
        if (action === "config:get" || action === "config:set") {
            return params?.id === "app-settings";
        }
        return false;
    }

    // Wraps frames when scoped to a paired computer
    private frame(payload: unknown): void {
        if (!this.ws) throw new Error("PaperCrane connection closed");
        const action = (payload as any)?.action ?? "";
        debug(`target=${this.computerId} wrapped=${!!this.tunnelId} action=${action}`);
        // Remote frames without a live tunnel must never hit the local daemon
        if (
            this.computerId !== "local" &&
            !this.tunnelId &&
            !this.isLocalOnlyChannel(action, (payload as any)?.params)
        ) {
            throw new Error(`No open tunnel to ${this.computerId}`);
        }
        if (this.tunnelId) {
            this.ws.send(
                JSON.stringify({
                    type: "tunnel",
                    id: this.tunnelId,
                    payload: JSON.stringify(payload),
                }),
            );
        } else {
            this.ws.send(JSON.stringify(payload));
        }
    }
}
