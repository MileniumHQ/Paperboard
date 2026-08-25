// WebSocket transport to a PaperCrane daemon.
//
// One connection serves every namespace. Frames are JSON-RPC-ish:
//   → { id, action, params }
//   ← { type:"response", id, result, error }
//   ← { type:"event", event, payload }
//
// ARCHITECTURAL INVARIANT: a transport is bound to exactly one computer at
// construction time (`computerId`) and can NEVER be retargeted. There is no
// global "active computer" and no code path may fall back to local. A
// remote-scoped transport wraps every frame in a tunnel envelope; if the
// tunnel is not open, frames FAIL LOUDLY instead of executing on the wrong
// machine. Multi-computer clients (the shell) hold one transport per
// computer; panels get theirs from the ?comp= bootstrap parameter of their
// iframe URL.
//
// Features the panel ecosystem relies on:
//   - auto-reconnect with backoff, replaying stream subscriptions
//   - tunneling through the local daemon for remote-scoped transports
//   - token auth injected into every request

import type * as fsType from "fs";

export interface TransportOptions {
    port?: number;
    token?: string;
    /**
     * Immutable computer scope ("local" or a paired id). Defaults to the
     * `comp` query parameter of the embedding page (panel iframes), else
     * "local".
     */
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

// Frame-level tracing, off by default. Enable with PAPERBOARD_TRANSPORT_DEBUG=1
// (node/shell) or localStorage["PAPERBOARD_TRANSPORT_DEBUG"]="1" (renderer).
const DEBUG =
    (typeof process !== "undefined" && process.env?.PAPERBOARD_TRANSPORT_DEBUG === "1") ||
    (typeof localStorage !== "undefined" &&
        (globalThis as any).localStorage?.getItem?.("PAPERBOARD_TRANSPORT_DEBUG") === "1");

function debug(msg: string): void {
    if (DEBUG) console.debug(`[transport] ${msg}`);
}

// The computer scope implied by the embedding document. Panel iframes are
// loaded as panel://<computerId>.<panelId>/ — the scope is the first label of
// the hostname, part of the origin itself. Hosts without a scope label (the
// shell itself) are local. There are no legacy fallbacks: a malformed scope
// fails loudly at the __crane check.
export function ambientScope(): string {
    if (typeof location !== "undefined") {
        const host = location.hostname || "";
        const dot = host.indexOf(".");
        if (dot > 0) return host.slice(0, dot);
    }
    return "local";
}

// Tunnel ids. Uses Web Crypto, which exists in Electron renderers, browsers,
// Bun and modern Node — the node:crypto module is NOT importable here because
// bundlers externalize it to an empty shim in browser builds (randomBytes
// would be undefined at runtime). Legacy-Node fallback imports lazily.
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

// Lazy Node builtins — resolved through a non-static specifier so bundlers
// don't constant-fold it into a browser-incompatible import (the fallbacks
// below are unreachable in browsers/Electron renderers anyway).
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

// Prefers the platform's native WebSocket (browsers, Bun, modern Node);
// falls back to the ws package on older Node runtimes. The indirection keeps
// bundlers from trying to resolve "ws" for browser builds.
async function getWebSocketImpl(): Promise<any> {
    const g = globalThis as any;
    if (typeof g.WebSocket !== "undefined") {
        // Native (browser/Electron/Bun) WebSocket speaks addEventListener;
        // adapt it to the ws-package shape our transport expects.
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
    // Immutable computer binding. Everything downstream routes by this field
    // and nothing may reassign it.
    public readonly computerId: string;
    private ws: any = null;
    private port: number | null = null;
    private token: string | null = null;
    private opts: TransportOptions = {};
    // Set by embedders (e.g. the Electron shell) whose origin cannot reach
    // the panel://__crane route directly. Supplies LOCAL daemon credentials
    // (port/token) only — never a computer scope.
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
    // Live tunnel to this.computerId. Null whenever the tunnel is down; a
    // remote-scoped transport with a null tunnelId refuses to send frames.
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
            // Browser (panel iframe): ask the host via the protocol route.
            // The scope rides the origin (hostname prefix); the host MUST
            // echo the same computer back — a mismatch means the bootstrap
            // route ignored the scope, which historically silently executed
            // panels on the wrong machine. Fail loudly instead.
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

        // Node (blocks/bots/headless): read the local handshake file. Node
        // runtimes are always local-scoped; remote access goes through the
        // daemon's own pairing, not this transport.
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

    // A live socket alone is not "connected" when scoped to a remote
    // computer: frames sent without a tunnel would execute on the local
    // daemon under this computer's name.
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

        // Reuse a live socket when only the tunnel is missing. A failed
        // tunnel open leaves the socket healthy; opening a second one here
        // would orphan the first connection's event handlers.
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
                    } catch {}
                });

                ws.on("close", () => {
                    this.ws = null;
                    // The tunnel lived on this socket; its id is dead now.
                    // Clear it so frames can't be wrapped into a stale tunnel
                    // while the socket is down — open() re-establishes it.
                    this.tunnelId = null;
                    this.emitStatus(false);
                    this.rejectAllPending("PaperCrane connection closed");
                    if (!this.closedByUser) this.scheduleReconnect();
                });
            });
        }

        // Remote scope: the tunnel IS the routing. It must be live before
        // this transport resolves as connected.
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

    /**
     * Stops the transport for good: closes the socket and cancels any
     * pending reconnect. Safe to call repeatedly.
     */
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
                    } catch {}
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
            } catch {}
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

        // Upstream leg dropped while our own socket is fine: rebuild the
        // tunnel and replay subscriptions, exactly like a full reconnect.
        if (msg.type === "tunnel-closed" && msg.id === this.tunnelId) {
            this.tunnelId = null;
            const reopen = async () => {
                if (this.computerId === "local") return;
                await this.openTunnel(this.computerId);
                await this.resubscribe();
            };
            reopen().catch((err) => {
                // Leave the tunnel down; the healthy socket stays up and the
                // next ensureConnected() retries the tunnel on demand. Do NOT
                // scheduleReconnect() here — that would discard a perfectly
                // good socket.
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
            // timeoutMs === null means "wait indefinitely" — for long-running
            // operations like package/file downloads whose reply only arrives
            // when the whole operation completes.
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
                    // Host-local state (e.g. shell settings) always executes
                    // on the local daemon even for remote-scoped transports.
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
            this.call("term:attach", { id }).catch(() => {});
        }
        for (const id of this.attachedProcesses) {
            this.call("process:attach", { id }).catch(() => {});
        }
    }

    /** True when frames should bypass an active tunnel (host-local state). */
    private isLocalOnlyChannel(action: string, params: any): boolean {
        if (action === "config:get" || action === "config:set") {
            return params?.id === "app-settings";
        }
        return false;
    }

    // Wraps frames when scoped to a paired computer. tunnelId is the single
    // source of routing truth: it is cleared on socket close and on tunnel
    // loss, so a non-null id always means a live leg.
    private frame(payload: unknown): void {
        if (!this.ws) throw new Error("PaperCrane connection closed");
        const action = (payload as any)?.action ?? "";
        debug(`target=${this.computerId} wrapped=${!!this.tunnelId} action=${action}`);
        // Hard stop: a remote-scoped frame without a live tunnel must never
        // fall through to the local daemon unwrapped — that would run the
        // operation on the wrong computer. Callers retry via ensureConnected,
        // which re-establishes the tunnel first.
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
