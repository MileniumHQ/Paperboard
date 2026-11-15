// transport router, every channel rides the WebSocket
import { CraneTransport } from "./ws";
import { debugErr } from "./debug";
import { attachShared, dropAttachmentLedger, releaseAttachment, type Resource } from "./attachments";
import { fileDownloadParams, panelInstallParams, processRunParams } from "./transport/params";
import type { EventPayload, RpcAction, RpcEvent, RpcParams, RpcResult } from "./protocol";
import type { SystemInfo } from "./system";
import { grantedComputerId, resolvePanelId } from "./identity";

export interface IpcRendererLike {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    send(channel: string, ...args: unknown[]): void;
    on(
        channel: string,
        listener: (event: any, ...args: any[]) => void,
    ): (() => void) | void;
    once?(
        channel: string,
        listener: (event: any, ...args: any[]) => void,
    ): void;
    removeListener?(channel: string, listener: (...args: any[]) => void): void;
    removeAllListeners?(channel?: string): void;
}

declare global {
    interface Window {
        electron?: {
            ipcRenderer?: IpcRendererLike;
        };
        ipcRenderer?: IpcRendererLike;
    }
}

// panel id resolution, priority and semantics live in src/identity.ts
export function getPanelId(): string {
    return resolvePanelId();
}

// ─── Transport registry ──────────────────────────────────────────────────────

// one transport per computer, bound at creation
const transports = new Map<string, CraneTransport>();
let initializedComputerId: string | undefined;
let hostCredentialProvider: CraneTransport["credentialProvider"] = null;

/** Explicit shell bootstrap. Panels never discover Electron IPC or inherit
 * this provider; each document/module owns its own transport registry. */
export function configureHostConnection(provider: NonNullable<CraneTransport["credentialProvider"]>): () => void {
    if (hostCredentialProvider) throw new Error("Host connection is already configured");
    hostCredentialProvider = provider;
    return () => {
        for (const transport of transports.values()) transport.close();
        transports.clear();
        hostCredentialProvider = null;
        initializedComputerId = undefined;
    };
}

export function getTransport(scope?: string): CraneTransport {
    const id = scope || initializedComputerId || grantedComputerId();
    let transport = transports.get(id);
    if (!transport) {
        transport = new CraneTransport({ computerId: id });
        transport.credentialProvider = hostCredentialProvider;
        if (transports.size >= 256) throw new Error("Too many computer transports; close unused transports first");
        transports.set(id, transport);
    }
    return transport;
}

// teardown path for the transport registry: closing without removing
// leaks one transport per scope forever
export function closeTransport(scope?: string): void {
    const id = scope || initializedComputerId || grantedComputerId();
    const transport = transports.get(id);
    if (transport) {
        transport.close();
        transports.delete(id);
        if (initializedComputerId === id) initializedComputerId = undefined;
    }
}

export interface InitOptions {
    port?: number;
    token?: string;
    panelId?: string;
    computerId?: string;
    /** Node-only: explicit handshake file location. */
    craneJsonPath?: string;
}

// re-init reuses the existing transport
export function initPaperApi(opts: InitOptions = {}): Promise<void> {
    const scope = opts.computerId || grantedComputerId();
    initializedComputerId = scope;
    if (transports.get(scope)?.isDisposed()) transports.delete(scope);
    if (!transports.has(scope)) {
        const transport = new CraneTransport(opts);
        transport.credentialProvider = hostCredentialProvider;
        transports.set(scope, transport);
    } else if (
        opts.port ||
        opts.token ||
        opts.panelId ||
        opts.computerId ||
        opts.craneJsonPath
    ) {
        console.warn(
            "[paperapi] initPaperApi called after bootstrap; transport options ignored",
        );
    }
    return getTransport(scope).ensureConnected();
}

// SDK method adapters. These only speak daemon RPC; Electron IPC is owned
// by the application shell and never used as an SDK fallback.

// default per-call timeout for routes without an explicit one; null on a
// route waits indefinitely (see CraneTransport.call)
const DEFAULT_ROUTE_TIMEOUT_MS = 30_000;

// an invoke() argument as params: an object as it is, anything else as none
const given = (arg: unknown): Record<string, unknown> => {
    const params: Record<string, unknown> = {};
    if (typeof arg === "object" && arg !== null) Object.assign(params, arg);
    return params;
};

interface RouteOptions<A extends RpcAction> {
    /** how invoke()'s arguments become the action's params; the first argument when left out */
    args?: (args: unknown[]) => Record<string, unknown> | Promise<Record<string, unknown>>;
    /** milliseconds to wait for the answer; null waits it out, 30 s when left out */
    timeoutMs?: number | null;
    /** what the transport keeps once the daemon answered (a process it replays on reconnect) */
    after?: (transport: CraneTransport, params: Record<string, unknown>, result: RpcResult<A>) => void;
}

/**
 * One SDK call: the daemon action it asks, and what of the answer its
 * caller gets. The SDK's own modules call it with params typed by the
 * contract (protocol/rpc.ts); invoke() hands its callers' arguments as they
 * are, and the daemon checks them. Either way the answer is checked.
 */
function route<A extends RpcAction, U>(action: A, unwrap: (result: RpcResult<A>) => U, options: RouteOptions<A> = {}) {
    const wait = options.timeoutMs === undefined ? DEFAULT_ROUTE_TIMEOUT_MS : options.timeoutMs;
    const ask = async (scope: string | undefined, params: Record<string, unknown>): Promise<U> => {
        const transport = getTransport(scope);
        const result = await transport.callAsGiven(action, params, wait);
        options.after?.(transport, params, result);
        return unwrap(result);
    };
    return {
        action,
        timeoutMs: options.timeoutMs,
        call: (scope: string | undefined, params: RpcParams<A>): Promise<U> => ask(scope, params),
        invoke: async (scope: string | undefined, args: unknown[]): Promise<U> => ask(scope, options.args ? await options.args(args) : given(args[0])),
    };
}

const done = () => undefined;

// a write the daemon answers { success: true } once it is kept; it refuses one it couldn't keep
const kept = (r: { success: boolean }, why: string): true => {
    if (!r.success) throw new Error(why);
    return true;
};

// a process the transport attaches to again after a reconnect
const trackProcess = (transport: CraneTransport, params: Record<string, unknown>) => {
    if (typeof params.id === "string") transport.trackProcess(params.id);
};

export const RPC_ROUTES = {
    "terminal-exists": route("term:exists", (r) => r.running),
    "terminal-shells": route("term:shells", (r) => r.shells),
    "file-get-path": route("file:getPath", (r) => r.path),
    "file-clear": route("file:clear", (r) => r.success),
    "file-exists": route("file:exists", (r) => r.exists),
    "file-write": route("file:write", (r) => r.path),
    "file-read": route("file:read", (r) => r.content),
    "file-delete": route("file:delete", (r) => r.success),
    "file-download": route("file:download", (r) => r.path, { args: ([a]) => fileDownloadParams(given(a)), timeoutMs: null }),
    // { id, path? } payload, see src/config.ts
    "config-get": route("config:get", (r) => r.data),
    "config-set": route("config:set", (r) => kept(r, "The config was not written")),
    "secrets-set": route("secrets:set", (r) => kept(r, "The vault did not keep the secret")),
    "secrets-get": route("secrets:get", (r) => ({ found: r.found, value: r.value ?? null })),
    "secrets-delete": route("secrets:delete", (r) => r.deleted),
    "secrets-list": route("secrets:list", (r) => r.keys),
    "secrets-purge": route("secrets:purge", (r) => r.purged),
    "backup-source-define": route("backup:source-define", done),
    "backup-status": route("backup:status", (r) => r),
    "backup-progress": route("backup:progress", (r) => r.progress),
    // a backup copies and uploads the panel's data, a restore downloads and
    // swaps it in: both take as long as the bytes do
    "backup-create": route("backup:create", (r) => r, { timeoutMs: null }),
    "backup-list": route("backup:list", (r) => r.backups),
    "backup-restore": route("backup:restore", (r) => r, { timeoutMs: null }),
    "backup-delete": route("backup:delete", done),
    "backup-schedule-set": route("backup:schedule-set", (r) => r),
    "backup-locations": route("backup:destinations", (r) => r.destinations),
    "backup-locations-problem": route("backup:destinations-problem", (r) => r.problem ?? null),
    "backup-locations-recover": route("backup:destinations-recover", (r) => ({ keptAs: r.keptAs })),
    "backup-location-usage": route("backup:destination-usage", (r) => r),
    // adding checks the location is reachable with its credentials
    "backup-location-add": route("backup:destination-add", (r) => r, { timeoutMs: 120_000 }),
    "backup-location-remove": route("backup:destination-remove", done),
    "backup-panel-location-set": route("backup:panel-destination-set", (r) => r),
    "problems-list": route("problems:list", (r) => r.problems),
    "problems-every": route("problems:every", (r) => r.panels),
    "ports-claim": route("ports:claim", (r) => r),
    "ports-prepare": route("ports:prepare", (r) => r),
    "ports-release": route("ports:release", done),
    "ports-list": route("ports:list", (r) => r.claims),
    "ports-all": route("ports:all", (r) => ({ claims: r.claims, policy: r.policy })),
    "ports-policy-set": route("ports:policy-set", (r) => r.policy),
    "package-is-installed": route("package:isInstalled", (r) => r.installed),
    "package-get-index": route("package:getIndex", (r) => r.index),
    // runtime updates staged on this computer that the caller's own
    // processes hold back; the daemon installs each once they stop
    "package-pending": route("package:pending", (r) => r.updates),
    // bare-string invoke: invoke("package-get-path", packageName)
    "package-get-path": route("package:getPath", (r) => r.path, { args: ([packageName]) => ({ packageName }) }),
    "package-download": route("package:download", (r) => r.path, { args: ([a]) => ({ packageName: given(a).packageName, downloadId: given(a).downloadId }), timeoutMs: null }),
    "panels-list": route("panel:list", (r) => r.panels),
    "panels-list-installed": route("panel:list", (r) => {
        if (!r.invalid) throw new Error("The computer answered the panel list with something that is not one");
        return { panels: r.panels, invalid: r.invalid };
    }),
    // invoke("panel-install", panelId): the registry's release, as the library showed it
    "panel-install": route("panel:install", (r) => {
        // only an install that may be held (the updater's) answers without the panel
        if (!r.panel) throw new Error("Paperboard Server installed no panel");
        return r.panel;
    }, {
        args: ([panelId]) => {
            if (typeof panelId !== "string") throw new Error(`Install refused: ${JSON.stringify(panelId)} is not a panel id`);
            return panelInstallParams(panelId);
        },
        timeoutMs: null,
    }),
    // invoke("panel-uninstall", panelId, deleteData?) — the second argument
    // is the explicit delete-data opt-in; absent or false keeps the user's
    // config, files and credentials
    "panel-uninstall": route("panel:uninstall", (r): { packagesWarning?: string } => (r.packagesWarning !== undefined ? { packagesWarning: r.packagesWarning } : {}), {
        args: ([panelId, deleteData]) => ({ panelId, deleteData: deleteData === true }),
        timeoutMs: null,
    }),
    // invoke("panel-restart-service", panelId); false when the panel has no
    // service to restart. Stop grace (<=6s) + readiness deadline (20s)
    "panel-restart-service": route("panel:restartService", (r) => r.restarted, { args: ([panelId]) => ({ panelId }), timeoutMs: 60_000 }),
    "process-exists": route("process:exists", (r) => r.running),
    // one shape for both channels: same wire params, same track
    // bookkeeping; only the returned envelope differs
    "process-start": route("process:run", () => ({ success: true }), { args: ([p]) => processRunParams(given(p)), after: trackProcess }),
    "process-run": route("process:run", (r) => r, { args: ([p]) => processRunParams(given(p)), after: trackProcess }),
    // the daemon answers success: false when no process has that id; only a
    // process that is there is replayed on reconnect
    "process-attach": route("process:attach", (r) => ({ success: r.success }), {
        after: (transport, params, r) => {
            if (r.success) trackProcess(transport, params);
        },
    }),
    "system-get-ip": route("system:ip", (r) => r.ip),
    // what PaperAPI's caller reads is the whole of it: every daemon since 0.1 says what it is and where
    "system-info": route("system:info", (r): SystemInfo => {
        const { service, version, ip } = r;
        if (service === undefined || version === undefined || ip === undefined) {
            throw new Error("Paperboard Server's answer to system:info doesn't fit: it doesn't say what it is, its version and its address");
        }
        return { ...r, service, version, ip };
    }),
    "system-gpus": route("system:gpus", (r) => r),
    "system-usage": route("system:usage", (r) => r, { timeoutMs: 15_000 }),
};

type Channel = keyof typeof RPC_ROUTES;
const isChannel = (channel: string): channel is Channel => Object.hasOwn(RPC_ROUTES, channel);

// ─── Event translation ───────────────────────────────────────────────────────

// One stream channel: the daemon event it reads, which of its payloads are
// the resource's, and what its listener is given.
function stream<E extends RpcEvent>(source: E, match: (payload: EventPayload<E>, id: string) => boolean, transform: (payload: EventPayload<E>) => unknown[]) {
    return {
        source,
        listen: (t: CraneTransport, id: string, listener: (...args: unknown[]) => void) =>
            t.subscribeEvent(source, (payload) => {
                if (match(payload, id)) listener(...transform(payload));
            }),
    };
}

const ofId = (p: { id: string }, id: string) => p.id === id;
const ofDownload = (p: { downloadId: string }, id: string) => p.downloadId === id;

const WS_EVENTS = {
    "terminal-data": stream("term:data", ofId, (p) => [p.data]),
    // a program killed by a signal has no code
    "terminal-exit": stream("term:exit", ofId, (p) => [{ exitCode: p.exitCode ?? undefined }]),
    "terminal-foreground": stream("term:foreground", ofId, (p) => [p.name]),
    "terminal-command": stream("term:command", ofId, (p) => [{ command: p.command, exitCode: p.exitCode }]),
    "terminal-cwd": stream("term:cwd", ofId, (p) => [p.cwd]),
    "process-data": stream("process:data", ofId, (p) => [p.data]),
    "process-stdout": stream("process:data", (p, id) => p.id === id && p.stream === "stdout", (p) => [p.data]),
    "process-stderr": stream("process:data", (p, id) => p.id === id && p.stream === "stderr", (p) => [p.data]),
    "process-exit": stream("process:exit", ofId, (p) => [{ exitCode: p.exitCode ?? undefined }]),
    "file-progress": stream("progress", ofDownload, (p) => [p]),
    "package-progress": stream("progress", ofDownload, (p) => [p]),
};

const isStream = (kind: string): kind is keyof typeof WS_EVENTS => Object.hasOwn(WS_EVENTS, kind);

// ─── Public router ───────────────────────────────────────────────────────────

// Route to the named computer or the explicitly initialized/granted one.
// The answer is checked against the action's shape; T is what the caller
// reads it as.
export async function invokeIn<T = unknown>(
    scope: string | undefined,
    channel: string,
    ...args: unknown[]
): Promise<T> {
    if (!isChannel(channel)) throw new Error(`[paperapi] Unhandled channel: ${channel}`);
    const answer: unknown = await RPC_ROUTES[channel].invoke(scope, args);
    return answer as T;
}

export async function invoke<T = unknown>(
    channel: string,
    ...args: unknown[]
): Promise<T> {
    return invokeIn<T>(undefined, channel, ...args);
}

// What send() writes to: a terminal's or a process's input, size and life.
const SENDS = {
    "terminal-create": "term:create",
    "terminal-write": "term:write",
    "terminal-resize": "term:resize",
    "terminal-destroy": "term:destroy",
    "process-write": "process:write",
    "process-close-input": "process:close-input",
    "process-kill": "process:kill",
} as const satisfies Record<string, RpcAction>;
type SendChannel = keyof typeof SENDS;
/** What a channel sends: its action's params (anything for a channel send() refuses). */
export type SendParams<C extends string> = C extends SendChannel ? RpcParams<(typeof SENDS)[C]> : unknown;
const isSendChannel = (channel: string): channel is SendChannel => Object.hasOwn(SENDS, channel);

// every channel rejects with the daemon's reason: a shell that could not
// start, or a process that would not die, must reach the caller that asked.
// A refused keystroke or resize reaches the terminal that sent it, which can
// say the session is gone and retry; a refused process write reaches its
// caller, which decides what it means (a console line is not a protocol frame).
export function send<C extends string>(channel: C, params?: SendParams<C>): Promise<void> {
    if (!isSendChannel(channel)) throw new Error(`[paperapi] IPC channel not allowed: ${channel}`);
    const t = getTransport();
    const sent = given(params);
    const id = typeof sent.id === "string" ? sent.id : "";
    // a destroyed or killed resource is gone: its ledger dies with it, so a
    // later resubscribe attaches fresh instead of seeing a stale count
    if (channel === "terminal-destroy" || channel === "process-kill") {
        const resource = channel === "terminal-destroy" ? "terminal" : "process";
        if (resource === "terminal") t.untrackTerminal(id);
        else t.untrackProcess(id);
        dropAttachmentLedger(resource, id, t);
    }
    return t.callAsGiven(SENDS[channel], sent).then(() => {
        if (channel === "terminal-create") t.trackTerminal(id);
    });
}

/**
 * A stream subscription: call it to unsubscribe. `attached` says whether the
 * connection is attached to the terminal or process the stream reads: true
 * once it is, false when nothing has that id yet (start it on this
 * connection and the stream flows), and it rejects with the daemon's reason
 * when the attach is refused. A connection lost before the answer rejects
 * too, and the SDK attaches again once it reconnects. A stream that reads no resource (download
 * progress) has nothing to attach and resolves true.
 */
export type StreamSubscription = (() => void) & { readonly attached: Promise<boolean> };

export function on(
    channel: string,
    listener: (event: any, ...args: any[]) => void,
): StreamSubscription {
    // Stream channels look like "<kind>:<resource-id>"
    const colonIndex = channel.indexOf(":");
    const kind = colonIndex === -1 ? channel : channel.slice(0, colonIndex);
    const suffix = colonIndex === -1 ? "" : channel.slice(colonIndex + 1);

    if (!isStream(kind)) {
        throw new Error(`[paperapi] IPC channel not allowed: ${channel}`);
    }

    const t = getTransport();
    const unsubscribe = WS_EVENTS[kind].listen(t, suffix, (...cbArgs) => {
        try {
            listener({}, ...cbArgs);
        } catch (err) {
            debugErr(`listener for ${channel}`, err);
        }
    });

    // eager connect so streams flow before first invoke
    t.ensureConnected().catch((err) => debugErr("stream eager connect", err));

    // Exit counts too: the daemon sends a resource's exit only to
    // connections attached to it, so an exit listener on a connection that
    // did not start the resource (a restarted service taking back a run)
    // would otherwise never hear it.
    const tracked: Resource | null =
        kind.startsWith("terminal-")
            ? "terminal"
            : kind.startsWith("process-")
            ? "process"
            : null;
    const attached = tracked ? attachShared(tracked, suffix, t) : Promise.resolve(true);

    const off = () => {
        unsubscribe();
        if (tracked) releaseAttachment(tracked, suffix, t);
    };
    return Object.assign(off, { attached });
}
