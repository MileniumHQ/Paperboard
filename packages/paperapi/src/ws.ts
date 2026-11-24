// WebSocket transport bound to one computer; remote frames ride a tunnel or fail
import { debug, debugErr } from "./debug";
import { PROTOCOL_VERSION, readValue, type EventPayload, type RpcAction, type RpcParams, type RpcResult } from "./protocol";
import { shape, type Infer } from "./shape";
import { newClientId } from "./channels";
import { TransportRegistry, type ActionHandler } from "./transport/registry";
import { grantedComputerId, resolveDefaultPanelId } from "./identity";
import { resolveCredentials, type CraneCredentials, type ResolvedCredentials } from "./transport/credentials";
import { webSocketImpl, type TransportSocket } from "./transport/socket";
import { answerActionCall, currentActionCall, loadActionCallScope } from "./transport/actionCalls";
import { errorMessage } from "./errors";
import type { BlockSchema } from "./blocksSchema";
import { isRecord } from "./records";

export { craneEndpoint, type CraneCredentials } from "./transport/credentials";

const LOCAL_ONLY_APP_SETTINGS = "app-settings";

// the frames the daemon sends a transport, each read before it is handled;
// a field one carries beyond these is kept, as an answer's may be
const FRAME = shape.either(
    shape.object({ type: shape.oneOf("tunnel"), payload: shape.text() }),
    shape.object({ type: shape.oneOf("tunnel-open"), id: shape.text() }),
    shape.object({ type: shape.oneOf("tunnel-closed"), id: shape.text(), reason: shape.optional(shape.text()) }),
    shape.object({
        type: shape.oneOf("action_call"),
        registry: shape.optional(shape.text()),
        callId: shape.text(),
        // a call that names no panel is refused: no handler owns it
        panelId: shape.optional(shape.text()),
        action: shape.text(),
        args: shape.optional(shape.json()),
    }),
    // a request's id, or the tunnel's whose opening failed; null when the
    // daemon couldn't read the request it answers
    shape.object({
        type: shape.oneOf("response"),
        id: shape.nullable(shape.either(shape.number(), shape.text())),
        result: shape.optional(shape.json()),
        error: shape.optional(shape.nullable(shape.text())),
        code: shape.optional(shape.nullable(shape.text())),
    }),
    shape.object({ type: shape.oneOf("event"), event: shape.text(), payload: shape.optional(shape.json()) }),
);
type Frame = Infer<typeof FRAME>;

// a frame as the daemon sent it, or null when it isn't JSON (said in the
// debug trace) or isn't a frame this transport knows (said on the console)
function readFrame(text: string): Frame | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        debug("dropping unparseable frame");
        return null;
    }
    try {
        return readValue(FRAME, value, "frame");
    } catch (err) {
        debugErr("dropping a frame that doesn't fit the protocol", err);
        return null;
    }
}

export interface TransportOptions {
    port?: number;
    token?: string;
    /** Immutable computer scope ("local" or a paired id); otherwise host-granted. */
    computerId?: string;
    /** Panel ID if running as a background service or specific panel context. */
    panelId?: string;
    /** Node-only: explicit handshake file instead of the default location. */
    craneJsonPath?: string;
}

type Listener = (payload: unknown) => void;
type StatusListener = (status: { connected: boolean; error?: string }) => void;

interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    // none for a call that waits as long as it takes
    timer: ReturnType<typeof setTimeout> | undefined;
}

const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 5_000;

export class CraneTransport {
    public readonly computerId: string;
    private ws: TransportSocket | null = null;
    // the credential every request carries, from the last resolve
    private token: string | null = null;
    private opts: TransportOptions = {};
    // supplies local daemon credentials
    public credentialProvider: (() => Promise<CraneCredentials>) | null = null;
    private pending = new Map<number, Pending>();
    private listeners = new Map<string, Set<Listener>>();
    private requestId = 1;
    // last subscription set announced to the daemon; null means not announced
    private lastSubscribedEvents: Set<string> | null = null;
    private subSyncScheduled = false;
    // a refused announcement is sent again on the reconnect backoff
    private subRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private subRetryAttempts = 0;
    // the newest events:subscribe call, settled once the daemon answered it
    private subscribing: Promise<unknown> = Promise.resolve();
    private connecting: Promise<void> | null = null;
    private reconnectAttempts = 0;
    private closedByUser = false;
    private authenticated = false;
    private cancelConnection: (() => void) | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private attachedTerminals = new Set<string>();
    private attachedProcesses = new Set<string>();
    // the Blocks registry (blocksApi): its names, handlers and replay
    private blocksRegistry = new TransportRegistry();
    // null tunnel means remote frames must fail
    private tunnelId: string | null = null;
    private isNode =
        typeof window === "undefined" &&
        typeof process !== "undefined" &&
        typeof process.versions?.node === "string";

    public statusListeners = new Set<StatusListener>();

    constructor(opts: TransportOptions = {}) {
        this.opts = opts;
        this.computerId = opts.computerId || grantedComputerId();
    }

    // ── Connection lifecycle ────────────────────────────────────────────────

    public onStatus(cb: StatusListener): void {
        this.statusListeners.add(cb);
    }

    public offStatus(cb: StatusListener): void {
        this.statusListeners.delete(cb);
    }

    private emitStatus(connected: boolean, error?: string): void {
        for (const cb of this.statusListeners) cb({ connected, error });
    }

    public isConnected(): boolean {
        return this.socketOpen() && this.authenticated && this.isRoutingLive();
    }

    private socketOpen(): boolean {
        return !!this.ws && this.ws.readyState === 1;
    }

    public isDisposed(): boolean { return this.closedByUser; }

    // Remote scope needs a live tunnel, not just a socket
    private isRoutingLive(): boolean {
        return this.computerId === "local" || !!this.tunnelId;
    }

    public async ensureConnected(): Promise<void> {
        if (this.closedByUser) throw new Error("PaperCrane transport is disposed");
        if (this.connecting) return this.connecting;
        if (this.isConnected()) return;
        this.connecting = this.open().finally(() => {
            this.connecting = null;
        });
        return this.connecting;
    }

    private async open(): Promise<void> {
        if (this.isNode) await loadActionCallScope();
        const creds = await resolveCredentials({
            port: this.opts.port,
            token: this.opts.token,
            computerId: this.computerId,
            isNode: this.isNode,
            provider: this.credentialProvider,
            craneJsonPath: this.opts.craneJsonPath,
        });
        this.token = creds.token;
        if (this.closedByUser) throw new Error("PaperCrane transport is disposed");

        // Reuse a live socket when only the tunnel is missing
        if (!this.socketOpen()) await this.openSocket(creds);

        if (!this.authenticated) {
            try {
                await this.request("auth:verify", {}, 10_000, false);
                this.authenticated = true;
            } catch (err) {
                this.ws?.close();
                this.ws = null;
                throw err;
            }
        }

        // Remote scope requires a live tunnel before "connected"
        if (this.computerId !== "local" && !this.tunnelId) {
            await this.openTunnel(this.computerId);
        }

        await this.resubscribe();
        this.emitStatus(true);
    }

    private async openSocket(creds: ResolvedCredentials): Promise<void> {
        const challenge = creds.challenge;
        const Ws = await webSocketImpl(!!challenge);
        if (this.closedByUser) throw new Error("PaperCrane transport is disposed");
        await new Promise<void>((resolve, reject) => {
            const ws = challenge ? new Ws(creds.endpoint, { headers: challenge.headers }) : new Ws(creds.endpoint);
            let settled = false;
            // a listener named by crane.json proves it holds the token in
            // its first frame, before the token is ever sent to it
            let awaitingProof = !!challenge;
            const fail = (err: Error) => {
                if (settled) return;
                settled = true;
                this.cancelConnection = null;
                clearTimeout(timeout);
                reject(err);
            };
            const timeout = setTimeout(() => {
                if (settled) return;
                fail(new Error("PaperCrane connection timed out"));
                ws.close();
            }, 10_000);
            this.cancelConnection = () => {
                if (settled) return;
                fail(new Error("PaperCrane transport disposed during connection"));
                ws.close();
            };
            const accept = () => {
                settled = true;
                this.cancelConnection = null;
                clearTimeout(timeout);
                this.ws = ws;
                this.reconnectAttempts = 0;
                resolve();
            };

            ws.on("open", () => {
                if (this.closedByUser || settled) { ws.close(); return; }
                if (!awaitingProof) accept();
            });

            ws.on("error", (err: Error) => fail(err));

            // a socket that failed to connect, or that the transport let go
            // of after (a refused sign-in), still hears its closing handshake
            // out, maybe after the next socket is up; what it hears then is no
            // longer the transport's. Whoever wants the connection back calls
            // keepConnected(), which tries again until it connects.
            const dropped = () => settled && this.ws !== ws;

            ws.on("message", (raw) => {
                if (dropped()) return;
                // a Buffer from the ws package is its text in UTF-8
                const text = String(raw);
                if (awaitingProof) {
                    awaitingProof = false;
                    const refused = challenge!.refusal(text);
                    if (refused) {
                        fail(refused);
                        ws.close();
                        return;
                    }
                    if (this.closedByUser || settled) { ws.close(); return; }
                    accept();
                    return;
                }
                try {
                    this.handleMessage(text);
                } catch (err) { debugErr("message handler", err); }
            });

            ws.on("close", (code, reason) => {
                if (dropped()) return;
                // the daemon names why it closed a socket (an auth timeout, a slow consumer): say it
                const why = `${code}${String(reason) ? ` ${String(reason)}` : ""}`;
                fail(new Error(`PaperCrane closed before connecting (${why})`));
                this.ws = null;
                this.authenticated = false;
                // Tunnel died with the socket; open() re-establishes it
                this.tunnelId = null;
                this.emitStatus(false);
                this.rejectAllPending(`PaperCrane connection closed (${why})`);
                if (!this.closedByUser) this.scheduleReconnect();
            });
        });
    }

    private scheduleReconnect(): void {
        if (this.closedByUser || this.reconnectTimer) return;
        const delay = Math.min(
            RECONNECT_MAX_MS,
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
        );
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.keepConnected();
        }, delay);
    }

    /**
     * Connects now if it isn't connected, for what no caller waits on (an
     * event subscription): a failure is recorded, told to the status
     * listeners with why, and tried again until it connects or is closed.
     * debugErr is always visible, the debug trace is not.
     */
    public keepConnected(): void {
        if (this.closedByUser) return;
        this.ensureConnected().catch((err) => {
            debugErr(`reconnect to ${this.computerId} failed`, err);
            this.emitStatus(false, errorMessage(err));
            this.scheduleReconnect();
        });
    }

    /** Stops the transport for good; safe to call repeatedly. */
    public close(): void {
        this.closedByUser = true;
        this.cancelConnection?.();
        this.cancelConnection = null;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.subRetryTimer) {
            clearTimeout(this.subRetryTimer);
            this.subRetryTimer = null;
        }
        this.ws?.close();
        this.ws = null;
        this.authenticated = false;
        this.tunnelId = null;
        this.rejectAllPending("PaperCrane transport closed");
        // Full teardown: the transport is stopped for good, so its callback
        // registries are released, not muted — a closed transport must not
        // hold references that keep panels (or their handlers) alive.
        // Re-subscription on a replacement transport re-attaches from a
        // clean slate.
        this.statusListeners.clear();
        this.listeners.clear();
        this.rawListeners.clear();
        this.attachedTerminals.clear();
        this.attachedProcesses.clear();
        this.lastSubscribedEvents = null;
    }

    private async openTunnel(computerId: string): Promise<void> {
        const id = newClientId("t");
        debug(`target=${computerId} opening tunnel ${id}`);
        try {
            await new Promise<void>((resolve, reject) => {
                // teardown on timeout: a refused tunnel must not leak its
                // handshake listener every retry
                const timeout = setTimeout(() => {
                    this.removeMessageListener(listener);
                    reject(new Error("Tunnel open timed out"));
                }, 5_000);
                const listener = (frame: Frame) => {
                    const answers = frame.type === "tunnel-open" || frame.type === "tunnel-closed" || (frame.type === "response" && !!frame.error);
                    if (!answers || frame.id !== id) return;
                    clearTimeout(timeout);
                    this.removeMessageListener(listener);
                    if (frame.type === "tunnel-open") resolve();
                    else reject(new Error(`Remote tunnel failed: ${(frame.type === "tunnel-closed" ? frame.reason : frame.error) ?? "closed"}`));
                };
                if (!this.ws) {
                    clearTimeout(timeout);
                    reject(new Error("Remote tunnel failed: PaperCrane is not connected"));
                    return;
                }
                this.addRawListener(listener);
                this.rawSend({
                    type: "remote:open",
                    id,
                    computerId,
                });
            });
        } catch (err) {
            debug(`target=${computerId} tunnel open FAILED: ${errorMessage(err)}`);
            this.tunnelId = null;
            throw err;
        }
        this.tunnelId = id;
        this.reconnectAttempts = 0;
        debug(`target=${computerId} tunnel ${id} open`);
    }

    // ── Raw messaging ───────────────────────────────────────────────────────

    // hear every frame before it is handled (the tunnel handshake waits here)
    private rawListeners = new Set<(frame: Frame) => void>();

    private addRawListener(cb: (frame: Frame) => void): void {
        this.rawListeners.add(cb);
    }

    private removeMessageListener(cb: (frame: Frame) => void): void {
        this.rawListeners.delete(cb);
    }

    private rawSend(obj: unknown): void {
        this.ws?.send(JSON.stringify(obj));
    }

    private handleMessage(text: string): void {
        let frame = readFrame(text);
        if (!frame) return;
        for (const cb of this.rawListeners) {
            try {
                cb(frame);
            } catch (err) { debugErr("raw listener", err); }
        }

        // Unwrap tunneled payloads into the normal pipeline
        if (frame.type === "tunnel") {
            frame = readFrame(frame.payload);
            if (!frame) return;
            debug(`target=${this.computerId} <- tunnel frame type=${frame.type}`);
        }

        switch (frame.type) {
            case "tunnel-closed":
                // Upstream leg dropped: the socket is healthy, so reconnecting
                // only rebuilds the tunnel and replays subscriptions through it
                if (frame.id !== this.tunnelId) return;
                this.tunnelId = null;
                this.emitStatus(false, `The tunnel to ${this.computerId} closed`);
                this.keepConnected();
                return;
            case "action_call":
                answerActionCall(this.blocksRegistry, frame, (reply) => this.frame(reply));
                return;
            case "response": {
                const id = typeof frame.id === "number" ? frame.id : null;
                const p = id === null ? undefined : this.pending.get(id);
                if (id === null || !p) {
                    // a response id with no pending call is a protocol anomaly
                    // (a late reply after a timeout, or a foreign frame);
                    // logged, not dropped silently
                    debug(
                        `dropping response for unknown id=${String(frame.id)} (${frame.error ? `error: ${frame.error}` : "timed-out or foreign frame"})`,
                    );
                    return;
                }
                this.pending.delete(id);
                clearTimeout(p.timer);
                // machine-readable code travels with the error when the
                // daemon speaks a version that knows codes
                if (frame.error) p.reject(Object.assign(new Error(frame.error), frame.code ? { code: frame.code } : {}));
                else p.resolve(frame.result);
                return;
            }
            case "event":
                this.dispatch(frame.event, frame.payload);
                return;
        }
    }

    private dispatch(event: string, payload: unknown): void {
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

    // BOUNDED: outstanding calls are capped, so long-running downloads and a
    // wedged daemon can't pile up here without limit. Past the cap the call
    // refuses with a typed error.
    private static readonly MAX_PENDING_CALLS = 1000;

    /** Asks the daemon; params and answer types come from protocol/rpc.ts. */
    public call<A extends RpcAction>(action: A, params: RpcParams<A>, timeoutMs?: number | null): Promise<RpcResult<A>>;
    /**
     * @deprecated Name no type: the action's own answer type is the one above.
     */
    public call<T = never>(action: RpcAction, params: [T] extends [never] ? never : Record<string, unknown>, timeoutMs?: number | null): Promise<T>;
    public call(action: RpcAction, params: Record<string, unknown>, timeoutMs: number | null = 30_000): Promise<unknown> {
        return this.callAsGiven(action, params, timeoutMs);
    }

    /**
     * Asks the daemon with params as a caller of invoke() gave them, which
     * the daemon checks.
     */
    public async callAsGiven<A extends RpcAction>(action: A, params: Record<string, unknown>, timeoutMs: number | null = 30_000): Promise<RpcResult<A>> {
        await this.ensureConnected();
        return (await this.request(action, params, timeoutMs)) as RpcResult<A>;
    }

    private request(action: string, params: Record<string, unknown> = {}, timeoutMs: number | null = 30_000, routed = true): Promise<unknown> {
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
        const duringCall = currentActionCall();
        if (duringCall) params = { ...params, duringCall };
        const finalParams = { ...params, token: this.token, v: PROTOCOL_VERSION };
        return new Promise<unknown>((resolve, reject) => {
            // null timeoutMs waits indefinitely (long-running operations)
            const timer =
                timeoutMs === null
                    ? undefined
                    : setTimeout(() => {
                          this.pending.delete(id);
                          reject(new Error(`PaperCrane '${action}' timed out`));
                      }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                if (!routed || this.isLocalOnlyChannel(action, finalParams)) {
                    if (!this.ws) throw new Error("PaperCrane connection closed");
                    this.ws.send(JSON.stringify({ id, action, params: finalParams }));
                } else {
                    this.frame({ id, action, params: finalParams });
                }
            } catch (err) {
                this.pending.delete(id);
                clearTimeout(timer);
                reject(err as Error);
            }
        });
    }

    /**
     * Hears an event pushed by the daemon. Any number of listeners may hear
     * one event; the daemon is told of it once. Returns the unsubscribe.
     */
    public subscribeEvent<E extends string>(event: E, cb: (payload: EventPayload<E>) => void): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
            this.scheduleSubSync();
        }
        const listener: Listener = (payload) => cb(payload as EventPayload<E>);
        set.add(listener);
        return () => this.unsubscribeEvent(event, listener);
    }

    private unsubscribeEvent(event: string, cb: Listener): void {
        const set = this.listeners.get(event);
        if (!set || !set.delete(cb) || set.size > 0) return;
        this.listeners.delete(event);
        this.scheduleSubSync();
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
        const announced = this.call("events:subscribe", { events: [...wanted] });
        this.subscribing = announced;
        announced.then(
            () => {
                if (this.lastSubscribedEvents === wanted) this.subRetryAttempts = 0;
            },
            (err) => {
                debugErr("events:subscribe sync", err);
                // the daemon never took this set: forget it, or every later
                // sync of the same listeners would skip it and leave them deaf
                if (this.lastSubscribedEvents !== wanted) return;
                this.lastSubscribedEvents = null;
                this.scheduleSubRetry();
            },
        );
    }

    private scheduleSubRetry(): void {
        if (this.closedByUser || this.subRetryTimer) return;
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, this.subRetryAttempts));
        this.subRetryAttempts++;
        this.subRetryTimer = setTimeout(() => {
            this.subRetryTimer = null;
            this.syncSubscriptions();
        }, delay);
    }

    /**
     * Resolves once the daemon acknowledged every event subscribed so far,
     * so an event that fires after it is heard; rejects with why it wasn't.
     */
    public async subscriptionsSettled(): Promise<void> {
        await this.ensureConnected();
        // a subscription made just now announces itself on the next microtask
        this.syncSubscriptions();
        await this.subscribing;
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

    // the transport's panel id: its explicit option, else the granted one;
    // empty when neither exists
    public getDefaultPanelId(): string {
        return resolveDefaultPanelId(this.opts.panelId);
    }

    /** Registers a panel's Blocks entries ("kind.id" or "project/kind.id") and their handlers, in one call. */
    public async registerBlocks(panelId: string, blocks: { entry: string; handler: ActionHandler; schema: BlockSchema }[]): Promise<void> {
        for (const { entry, handler, schema } of blocks) this.blocksRegistry.addAction(panelId, entry, handler, schema);
        await this.ensureConnected();
        await this.call("blocks:register-set", { panelId, entries: blocks.map(({ entry, schema }) => ({ entry, schema })) });
    }

    public async unregisterBlock(panelId: string, entry: string): Promise<void> {
        this.blocksRegistry.removeAction(panelId, entry);
        await this.ensureConnected();
        await this.call("blocks:unregister", { panelId, entry });
    }

    public async defineBlocksProject(panelId: string, project: { id: string; name: string; icon?: string; image?: string }): Promise<void> {
        await this.ensureConnected();
        await this.call("blocks:project-define", { panelId, project: project.id, name: project.name, icon: project.icon, image: project.image });
        this.blocksRegistry.addProject({ panelId, ...project });
    }

    public async removeBlocksProject(panelId: string, projectId: string): Promise<void> {
        this.blocksRegistry.removeProject(panelId, projectId);
        await this.ensureConnected();
        await this.call("blocks:project-remove", { panelId, project: projectId });
    }

    // replays attachments and registrations after reconnect
    private async resubscribe(): Promise<void> {
        // the daemon forgot this socket's subscriptions; re-announce the set
        this.lastSubscribedEvents = null;
        this.syncSubscriptions();

        for (const id of this.attachedTerminals) {
            this.request("term:attach", { id }).catch((err) => debugErr(`term:attach ${id}`, err));
        }
        for (const id of this.attachedProcesses) {
            this.request("process:attach", { id }).catch((err) => debugErr(`process:attach ${id}`, err));
        }

        await this.blocksRegistry.resubscribe(
            (action, params) => this.request(action, params),
            (label, err) => debugErr(label, err),
        );
    }

    /** True when frames should bypass an active tunnel (host-local state). */
    private isLocalOnlyChannel(action: unknown, params: unknown): boolean {
        return (action === "config:get" || action === "config:set") && isRecord(params) && params.id === LOCAL_ONLY_APP_SETTINGS;
    }

    private frame(payload: Record<string, unknown>): void {
        if (!this.ws) throw new Error("PaperCrane connection closed");
        const action = payload.action ?? "";
        debug(`target=${this.computerId} wrapped=${!!this.tunnelId} action=${action}`);
        // Remote frames without a live tunnel must never hit the local daemon
        if (
            this.computerId !== "local" &&
            !this.tunnelId &&
            !this.isLocalOnlyChannel(action, payload.params)
        ) {
            throw new Error(`No open tunnel to ${this.computerId}`);
        }
        if (this.tunnelId) {
            // the remote authenticates the tunnel itself (host-granted scope);
            // this computer's credential never travels to another computer
            const params = payload.params;
            const forwarded = isRecord(params) && "token" in params ? { ...payload, params: { ...params, token: undefined } } : payload;
            this.ws.send(
                JSON.stringify({
                    type: "tunnel",
                    id: this.tunnelId,
                    payload: JSON.stringify(forwarded),
                }),
            );
        } else {
            this.ws.send(JSON.stringify(payload));
        }
    }
}
