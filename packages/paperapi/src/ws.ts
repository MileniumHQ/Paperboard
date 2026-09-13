// WebSocket transport bound to one computer; remote frames ride a tunnel or fail
import type * as fsType from "fs";

import { debug, debugErr } from "./debug";
import { PROTOCOL_VERSION } from "./protocol";
import { TransportRegistry } from "./transport/registry";
import { ambientScope, resolveDefaultPanelId } from "./identity";
import { serviceBootContext } from "./boot";

const LOCAL_ONLY_APP_SETTINGS = "app-settings";

export interface TransportOptions {
    port?: number;
    token?: string;
    /** Immutable computer scope ("local" or a paired id); defaults ambient. */
    computerId?: string;
    /** Panel ID if running as a background service or specific panel context. */
    panelId?: string;
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

async function randomTunnelId(): Promise<string> {
    const c = (globalThis as any).crypto;
    if (c?.getRandomValues) {
        const bytes = new Uint8Array(6);
        c.getRandomValues(bytes);
        return `t-${Array.from(bytes, (b) =>
            b.toString(16).padStart(2, "0"),
        ).join("")}`;
    }
    const mod = await import(/* @vite-ignore */ "node:crypto");
    return `t-${mod.randomBytes(6).toString("hex")}`;
}

// @vite-ignore keeps node builtins out of browser builds
async function nodeBuiltin(name: string): Promise<any> {
    return import(/* @vite-ignore */ `node:${name}`);
}

function defaultCraneJsonPath(pathMod: any): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return pathMod.join(
        process.env.PAPERBOARD_DIR || pathMod.join(home, ".paperboard"),
        "local",
        "crane.json",
    );
}

async function getWebSocketImpl(): Promise<any> {
    const g = globalThis as any;
    if (typeof g.WebSocket !== "undefined") {
            // Adapt native events to the ws-package shape
        return class NativeAdapter {
            private _ws: WebSocket;
            private _wrapped = new Map<(arg?: any) => void, { event: string; fn: EventListener }>();
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
                // Detach every adapted listener so reconnects don't leak.
                const remove = (this._ws as any).removeEventListener?.bind(this._ws);
                if (remove) {
                    for (const { event, fn } of this._wrapped.values()) {
                        try {
                            remove(event, fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                    }
                }
                this._wrapped.clear();
                this._ws.close();
            }
            on(event: string, cb: (arg?: any) => void) {
                const wrapped: EventListener =
                    event === "message"
                        ? (e) => cb((e as MessageEvent).data)
                        : () => cb();
                this._wrapped.set(cb, { event, fn: wrapped });
                this._ws.addEventListener(event, wrapped);
            }
            off(event: string, cb?: (arg?: any) => void) {
                const remove = (this._ws as any).removeEventListener?.bind(this._ws);
                if (!remove) {
                    if (cb) this._wrapped.delete(cb);
                    else {
                        for (const [orig, entry] of this._wrapped) {
                            if (entry.event === event) this._wrapped.delete(orig);
                        }
                    }
                    return;
                }
                if (cb) {
                    const entry = this._wrapped.get(cb);
                    if (entry && entry.event === event) {
                        try {
                            remove(event, entry.fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                        this._wrapped.delete(cb);
                    }
                    return;
                }
                for (const [orig, entry] of this._wrapped) {
                    if (entry.event === event) {
                        try {
                            remove(event, entry.fn);
                        } catch (err) { debugErr("detach shim listener", err) }
                        this._wrapped.delete(orig);
                    }
                }
            }
        };
    }
    const mod = await import(/* @vite-ignore */ "ws");
    return mod.default ?? mod.WebSocket ?? mod;
}

export class CraneTransport {
    public readonly computerId: string;
    private ws: any = null;
    private port: number | null = null;
    private token: string | null = null;
    private opts: TransportOptions = {};
    // supplies local daemon credentials
    public credentialProvider: (() => Promise<{
        port: number;
        token: string;
    }>) | null = null;
    private pending = new Map<number, Pending>();
    private listeners = new Map<string, Set<Listener>>();
    private requestId = 1;
    // last subscription set announced to the daemon; null means not announced
    private lastSubscribedEvents: Set<string> | null = null;
    private subSyncScheduled = false;
    private connecting: Promise<void> | null = null;
    private reconnectAttempts = 0;
    private closedByUser = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private attachedTerminals = new Set<string>();
    private attachedProcesses = new Set<string>();
    private registry = new TransportRegistry(() => this.resolveDefaultPanelId());
    // null tunnel means remote frames must fail
    private tunnelId: string | null = null;
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

        // service boot context: credentials GRANTED at service start
        // (in-process boot window or spawned-service env, captured once in
        // boot.ts). Issued credentials outrank discovered ones — a service
        // never reads crane.json or ambient env to find out who it is.
        const boot = serviceBootContext();
        if (boot) {
            this.port = boot.port;
            this.token = boot.token;
            return;
        }

        if (!this.isNode) {
            // Browser: credentials are injected by the host at serve time
            // (scoped to this document's computer). No fetch fallback.
            const injected = (globalThis as any).__PAPERBOARD_CRANE;
            if (!injected?.port || !injected?.token) {
                throw new Error("Paperboard host unavailable (no injected crane credentials)");
            }
            if (injected.computerId !== this.computerId) {
                throw new Error(
                    `Paperboard host served credentials for "${injected.computerId}" but this panel is scoped to "${this.computerId}"`,
                );
            }
            this.port = injected.port;
            this.token = injected.token;
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
        // the handshake file is a trust boundary: garbage fields must fail
        // here with a typed message, not as ws://127.0.0.1:undefined later
        if (!raw || typeof raw !== "object") {
            throw new Error(`Invalid crane handshake file (expected an object): ${file}`);
        }
        if (typeof raw.port !== "number" || !Number.isFinite(raw.port)) {
            throw new Error(`Invalid crane handshake file (port must be a number): ${file}`);
        }
        if (typeof raw.token !== "string" || raw.token.length === 0) {
            throw new Error(`Invalid crane handshake file (token must be a non-empty string): ${file}`);
        }
        this.port = raw.port;
        this.token = raw.token;
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    public onStatus(cb: Listener): void {
        this.statusListeners.add(cb);
    }

    public offStatus(cb: Listener): void {
        this.statusListeners.delete(cb);
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

        await this.resubscribe();
    }

    private scheduleReconnect(): void {
        const delay = Math.min(
            RECONNECT_MAX_MS,
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.closedByUser) return;
            // a dropped reconnect must be recorded, not just retried:
            // debugErr is always visible, debug-trace is not
            this.open().catch((err) => {
                debugErr("reconnect attempt failed", err);
                this.emitStatus(false, err instanceof Error ? err.message : String(err));
                this.scheduleReconnect();
            });
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
        // Full teardown: the transport is stopped for good, so its callback
        // registries are released, not muted — a closed transport must not
        // hold references that keep panels (or their handlers) alive.
        // Re-subscription on a replacement transport re-attaches from a
        // clean slate.
        this.statusListeners.clear();
        this.listeners.clear();
        this.sourceSubs.clear();
        this.rawListeners.clear();
        this.attachedTerminals.clear();
        this.attachedProcesses.clear();
        this.lastSubscribedEvents = null;
    }

    private async openTunnel(computerId: string): Promise<void> {
        const id = await randomTunnelId();
        debug(`target=${computerId} opening tunnel ${id}`);
        try {
            await new Promise<void>((resolve, reject) => {
                // teardown on timeout: a refused tunnel must not leak its
                // handshake listener every retry
                const timeout = setTimeout(() => {
                    this.removeMessageListener(listener);
                    reject(new Error("Tunnel open timed out"));
                }, 5_000);
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
                                clearTimeout(timeout);
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
            this.tunnelId = null;
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
            debug("dropping unparseable frame");
            return;
        }

        // Unwrap tunneled payloads into the normal pipeline
        if (msg.type === "tunnel" && typeof msg.payload === "string") {
            try {
                msg = JSON.parse(msg.payload);
                debug(`target=${this.computerId} <- tunnel frame id=${msg.id ?? ""} type=${msg.type}`);
            } catch {
                debug("dropping unparseable tunneled frame");
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

        if (msg.type === "action_call") {
            const { callId, action, args } = msg;
            // namespaced dispatch: unique composite owner only; ambiguous
            // bare names are refused rather than resolved last-writer-wins
            const handler = this.registry.resolveHandler(action);
            if (!handler) {
                this.rawSend({
                    type: "action_reply",
                    callId,
                    error: `Handler for action '${action}' not found`,
                });
                return;
            }
            Promise.resolve()
                .then(() => handler(...(Array.isArray(args) ? args : [])))
                .then((result) => {
                    this.rawSend({
                        type: "action_reply",
                        callId,
                        result: result === undefined ? null : result,
                    });
                })
                .catch((err: any) => {
                    this.rawSend({
                        type: "action_reply",
                        callId,
                        error: err?.message || String(err),
                    });
                });
            return;
        }

        if (msg.type === "response") {
            const p = this.pending.get(msg.id);
            if (p) {
                this.pending.delete(msg.id);
                clearTimeout(p.timer);
                if (msg.error) {
                    const err = new Error(msg.error);
                    // machine-readable code travels with the error when the
                    // daemon speaks a version that knows codes
                    if (msg.code) (err as any).code = msg.code;
                    p.reject(err);
                } else {
                    p.resolve(msg.result);
                }
            } else {
                // a response id with no pending call is a protocol anomaly
                // (a late reply after a timeout, or a foreign frame);
                // logged, not dropped silently
                debug(
                    `dropping response for unknown id=${msg.id} (${msg.error ? `error: ${msg.error}` : "timed-out or foreign frame"})`,
                );
            }
        } else if (msg.type === "event") {
            this.dispatch(msg.event, msg.payload);
        }
    }

    private dispatch(event: string, payload: any): void {
        const set = this.listeners.get(event);
        if (!set) return;
        // per-listener isolation: one throwing panel listener must not
        // abort delivery of the same event to the others (raw listeners
        // already had this; one invariant, one implementation applies)
        for (const cb of set) {
            try {
                cb(payload);
            } catch (err) {
                debugErr(`listener for ${event}`, err);
            }
        }
    }

    private rejectAllPending(reason: string): void {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error(reason));
        }
        this.pending.clear();
    }

    // ── Public API used by the namespace router ─────────────────────────────

    // BOUNDED: outstanding calls are capped — long-running downloads and a
    // wedged daemon previously compounded here without limit. Past the cap
    // the call refuses with a typed error instead of compounding.
    private static readonly MAX_PENDING_CALLS = 1000;

    public async call(action: string, params: Record<string, unknown> = {}, timeoutMs: number | null = 30_000): Promise<any> {
        await this.ensureConnected();

        if (this.pending.size >= CraneTransport.MAX_PENDING_CALLS) {
            throw new Error(
                `PaperCrane transport has ${this.pending.size} outstanding calls (cap ${CraneTransport.MAX_PENDING_CALLS}); refusing to queue '${action}'`,
            );
        }

        const id = this.requestId++;
        // token last: a params object that happens to carry a token (or a
        // typo'd field) can never clobber the real credential.
        // v marks the wire protocol version — the daemon refuses unknown
        // versions with a typed BAD_PROTOCOL error instead of guessing
        const finalParams = { ...params, token: this.token, v: PROTOCOL_VERSION };
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
            this.scheduleSubSync();
        }
        set.add(cb);
    }

    public unsubscribeEvent(event: string, cb?: Listener): void {
        if (!cb) {
            if (this.listeners.delete(event)) this.scheduleSubSync();
        } else {
            const set = this.listeners.get(event);
            if (!set) return;
            set.delete(cb);
            if (set.size <= 0) {
                this.listeners.delete(event);
                this.scheduleSubSync();
            }
        }
    }

    // fan-out for channels sharing one upstream event
    private sourceSubs = new Map<string, Set<Listener>>();

    public subscribeSource(
        source: string,
        cb: Listener,
    ): () => void {
        let set = this.sourceSubs.get(source);
        if (!set) {
            set = new Set();
            this.sourceSubs.set(source, set);
            const live = set;
            this.subscribeEvent(source, (payload) => {
                for (const inner of live) inner(payload);
            });
        }
        set.add(cb);
        return () => this.unsubscribeSource(source, cb);
    }

    public unsubscribeSource(
        source: string,
        cb: Listener,
    ): void {
        const set = this.sourceSubs.get(source);
        if (!set || !set.has(cb)) return;
        set.delete(cb);
        if (set.size <= 0) {
            this.unsubscribeEvent(source);
            this.sourceSubs.delete(source);
        }
    }

    // ── Broadcast subscription sync ──────────────────────────────────────────
    // the daemon only broadcasts events the socket declared via
    // events:subscribe (full-replace). Kept in sync with the listeners set.

    private scheduleSubSync(): void {
        if (this.subSyncScheduled) return;
        this.subSyncScheduled = true;
        queueMicrotask(() => {
            this.subSyncScheduled = false;
            this.syncSubscriptions();
        });
    }

    private async syncSubscriptions(): Promise<void> {
        if (!this.isConnected()) return;
        const wanted = new Set(this.listeners.keys());
        // An empty declaration is indistinguishable from no declaration on the
        // daemon; don't burn a tunnel round-trip announcing nothing.
        const neverDeclared =
            !this.lastSubscribedEvents || this.lastSubscribedEvents.size === 0;
        if (wanted.size === 0 && neverDeclared) return;
        if (
            this.lastSubscribedEvents &&
            this.lastSubscribedEvents.size === wanted.size &&
            [...wanted].every((e) => this.lastSubscribedEvents!.has(e))
        ) {
            return;
        }
        this.lastSubscribedEvents = wanted;
        this.call("events:subscribe", { events: [...wanted] }).catch((err) =>
            debugErr("events:subscribe sync", err),
        );
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

    private resolveDefaultPanelId(): string {
        return resolveDefaultPanelId(this.opts.panelId);
    }

    // the transport's own resolved identity: private because it may be an
    // ambient fallback (deprecated), public because panels legitimately
    // need "my panel id" for default subscriptions — with the same
    // loud-warning discipline the fallback carries everywhere else
    public getDefaultPanelId(): string {
        return this.resolveDefaultPanelId();
    }

    public setActionHandler(
        actionName: string,
        handler: (...args: any[]) => Promise<any> | any,
        panelId?: string,
        schema?: any,
    ): void {
        this.registry.setActionHandler(actionName, handler, panelId, schema);
    }

    public async registerAction(
        panelId: string,
        actionName: string,
        handler: (...args: any[]) => Promise<any> | any,
        schema?: any,
    ): Promise<void> {
        this.registry.addAction(panelId, actionName, handler, schema);
        await this.ensureConnected();
        await this.call("actions:register", { panelId, action: actionName, schema });
    }

    public async registerTrigger(
        panelId: string,
        triggerName: string,
        schema?: any,
    ): Promise<void> {
        this.registry.addTrigger(panelId, triggerName, schema);
        await this.ensureConnected();
        await this.call("triggers:register", { panelId, trigger: triggerName, schema });
    }

    public async registerMultipleActions(
        panelId: string,
        actionsMap: Record<string, (...args: any[]) => Promise<any> | any>,
    ): Promise<void> {
        const names = this.registry.addActions(panelId, actionsMap);
        await this.ensureConnected();
        await this.call("actions:register", { panelId, actions: names });
    }

    public async unregisterAction(panelId: string, actionName: string): Promise<void> {
        this.registry.removeAction(panelId, actionName);
        await this.ensureConnected();
        await this.call("actions:unregister", { panelId, action: actionName });
    }

    public async unregisterTrigger(panelId: string, triggerName: string): Promise<void> {
        this.registry.removeTrigger(panelId, triggerName);
        await this.ensureConnected();
        await this.call("triggers:unregister", { panelId, trigger: triggerName });
    }

    // replays attachments and registrations after reconnect
    private async resubscribe(): Promise<void> {
        // the daemon forgot this socket's subscriptions; re-announce the set
        this.lastSubscribedEvents = null;
        this.syncSubscriptions();

        for (const id of this.attachedTerminals) {
            this.call("term:attach", { id }).catch((err) => debugErr(`term:attach ${id}`, err));
        }
        for (const id of this.attachedProcesses) {
            this.call("process:attach", { id }).catch((err) => debugErr(`process:attach ${id}`, err));
        }

        await this.registry.resubscribe(
            (action, params) => this.call(action, params),
            (label, err) => debugErr(label, err),
        );
    }

    /** True when frames should bypass an active tunnel (host-local state). */
    private isLocalOnlyChannel(action: string, params: any): boolean {
        if (action === "config:get" || action === "config:set") {
            return params?.id === LOCAL_ONLY_APP_SETTINGS;
        }
        return false;
    }

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
