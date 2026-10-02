// transport router, every channel rides the WebSocket
import { CraneTransport } from "./ws";
import { debugErr } from "./debug";
import { REGISTRY_URL, fetchRegistryIndex } from "./config";
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

export function unpackIpcPayload<T>(event: unknown, data: T): T | unknown {
    return data !== undefined ? data : event;
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

interface WsRoute {
    action: string;
    params?: (args: any[]) => Record<string, unknown>;
    unwrap?: (result: any) => any;
    timeoutMs?: number | null;
}

// default per-call timeout for table routes without an explicit one; null
// on a route waits indefinitely (see CraneTransport.call)
const DEFAULT_ROUTE_TIMEOUT_MS = 30_000;

export const RPC_ROUTES: Record<string, WsRoute> = {
    "terminal-exists": {
        action: "term:exists",
        unwrap: (r) => r.running,
    },
    "file-get-path": {
        action: "file:getPath",
        unwrap: (r) => r.path,
    },
    "file-clear": {
        action: "file:clear",
        unwrap: (r) => r.success,
    },
    "file-exists": {
        action: "file:exists",
        unwrap: (r) => r.exists,
    },
    "file-write": {
        action: "file:write",
        unwrap: (r) => r.path,
    },
    "file-read": {
        action: "file:read",
        unwrap: (r) => r.content,
    },
    "file-delete": {
        action: "file:delete",
        unwrap: (r) => r.success,
    },
    "config-get": {
        // { id, path? } payload, see src/config.ts
        action: "config:get",
        unwrap: (r) => r.data,
    },
    "config-set": {
        action: "config:set",
        unwrap: (r) => r.success,
    },
    "secrets-set": {
        action: "secrets:set",
        unwrap: (r) => r.success,
    },
    "secrets-get": {
        action: "secrets:get",
        unwrap: (r) => ({ found: !!r?.found, value: r?.value ?? null }),
    },
    "secrets-delete": {
        action: "secrets:delete",
        unwrap: (r) => r.deleted,
    },
    "secrets-list": {
        action: "secrets:list",
        unwrap: (r) => r.keys ?? [],
    },
    "secrets-purge": {
        action: "secrets:purge",
        unwrap: (r) => r.purged ?? 0,
    },
    "package-is-installed": {
        action: "package:isInstalled",
        unwrap: (r) => r.installed,
    },
    "package-get-index": {
        action: "package:getIndex",
        unwrap: (r) => r.index,
    },
    "package-get-path": {
        // Bare-string invoke: invoke("package-get-path", packageName)
        action: "package:getPath",
        params: (args) => ({ packageName: args[0] }),
        unwrap: (r) => r.path,
    },
    "panels-list": {
        action: "panel:list",
        unwrap: (r) => r.panels ?? [],
    },
    "panel-uninstall": {
        // Bare-string invoke: invoke("panel-uninstall", panelId)
        action: "panel:uninstall",
        params: (args) => ({ panelId: args[0] }),
        unwrap: (r) => r.success ?? true,
        timeoutMs: null,
    },
    "panel-restart-service": {
        // Bare-string invoke: invoke("panel-restart-service", panelId).
        // Resolves false when the panel has no service to restart.
        action: "panel:restartService",
        params: (args) => ({ panelId: args[0] }),
        unwrap: (r) => r.restarted === true,
        // stop grace (<=6s) + readiness deadline (20s)
        timeoutMs: 60_000,
    },
    "process-exists": {
        action: "process:exists",
        unwrap: (r) => r.running,
    },
    "system-get-ip": {
        action: "system:ip",
        unwrap: (r) => r.ip,
    },
    "system-info": {
        action: "system:info",
        unwrap: (r) => r,
    },
    "system-gpus": {
        action: "system:gpus",
        unwrap: (r) => ({ gpus: Array.isArray(r?.gpus) ? r.gpus : [], errors: Array.isArray(r?.errors) ? r.errors : [] }),
    },
    "system-notify": {
        action: "system:notify",
        unwrap: (r) => r,
    },
    "system-screenshot": {
        action: "system:screenshot",
        unwrap: (r) => r?.savePath ?? r,
    },
    "system-set-volume": {
        action: "system:set-volume",
        unwrap: (r) => r?.volume ?? r,
    },
    "system-set-muted": {
        action: "system:set-muted",
        unwrap: (r) => r?.muted ?? r,
    },
    "system-beep": {
        action: "system:beep",
        unwrap: (r) => r,
    },
};

// bespoke channels (progress subscriptions, registry lookups)
const LONG_TIMEOUT = null;

async function invokeSpecial(
    channel: string,
    args: any[],
    scope?: string,
): Promise<any> {
    const t = getTransport(scope);

    switch (channel) {
        case "file-download": {
            const a = args[0] as any;
            const result = await t.call(
                "file:download",
                {
                    url: a.url,
                    targetPath: a.targetPath,
                    appId: a.appId,
                    downloadId: a.downloadId,
                    options: {
                        sha1: a.sha1,
                        sha256: a.sha256,
                        checksum: a.checksum,
                    },
                },
                LONG_TIMEOUT,
            );
            return result.path;
        }

        case "package-download": {
            const { packageName, downloadId } = args[0] as any;
            const result = await t.call(
                "package:download",
                { packageName, downloadId },
                LONG_TIMEOUT,
            );
            return result.path;
        }

        case "panel-install": {
            const [panelId] = args;
            // the daemon resolves the release from its own registry; the
            // index entry the library showed travels as what we expect, so a
            // release that changed in between refuses instead of installing
            // something the user did not pick
            let sha256: string | undefined;
            let version: string | undefined;
            try {
                const registryData = await fetchRegistryIndex();
                const record = registryData?.[panelId];
                if (!record) throw new Error(`the registry does not list "${panelId}"`);
                sha256 = typeof record.sha256 === "string" ? record.sha256 : undefined;
                version = typeof record.version === "string" ? record.version : undefined;
            } catch (err: any) {
                debugErr("panel-install registry lookup", err);
                throw new Error(
                    `Install refused for "${panelId}": ${err?.message || "registry lookup failed"}`,
                );
            }
            const result = await t.call(
                "panel:install",
                {
                    panelId,
                    sha256,
                    version,
                    // TODO(remove after v0.2): daemons before registry-resolved
                    // installs require this; current daemons ignore it
                    downloadUrl: `${REGISTRY_URL}/panel/${panelId}/download`,
                },
                LONG_TIMEOUT,
            );
            return result.panel;
        }

        case "process-start":
        case "process-run": {
            // one shape for both channels: same wire params, same track
            // bookkeeping; only the returned envelope differs
            const p = args[0] as any;
            const res = await t.call("process:run", {
                id: p.id,
                command: p.command,
                args: p.args || [],
                cwd: p.cwd,
                env: p.env,
            });
            t.trackProcess(p.id);
            return channel === "process-start" ? { success: true } : res;
        }

        case "process-attach": {
            const { id } = args[0] as any;
            await t.call("process:attach", { id });
            t.trackProcess(id);
            return { success: true };
        }

        default:
            throw new Error(`[paperapi] Unhandled channel: ${channel}`);
    }
}

// ─── Event translation ───────────────────────────────────────────────────────

interface EventRoute {
    source: string;
    match?: (payload: any, suffix: string) => boolean;
    transform?: (payload: any) => any[];
}

const WS_EVENTS: Record<string, EventRoute> = {
    "terminal-data": {
        source: "term:data",
        match: (p, id) => p.id === id,
        transform: (p) => [p.data],
    },
    "terminal-exit": {
        source: "term:exit",
        match: (p, id) => p.id === id,
        transform: (p) => [{ exitCode: p.exitCode }],
    },
    "process-data": {
        source: "process:data",
        match: (p, id) => p.id === id,
        transform: (p) => [p.data],
    },
    "process-stdout": {
        source: "process:data",
        match: (p, id) => p.id === id && p.stream === "stdout",
        transform: (p) => [p.data],
    },
    "process-stderr": {
        source: "process:data",
        match: (p, id) => p.id === id && p.stream === "stderr",
        transform: (p) => [p.data],
    },
    "process-exit": {
        source: "process:exit",
        match: (p, id) => p.id === id,
        transform: (p) => [{ exitCode: p.exitCode }],
    },
    "file-progress": {
        source: "progress",
        match: (p, id) => p.downloadId === id,
        transform: (p) => [p],
    },
    "package-progress": {
        source: "progress",
        match: (p, id) => p.downloadId === id,
        transform: (p) => [p],
    },
};

// ─── Public router ───────────────────────────────────────────────────────────

// Route to the named computer or the explicitly initialized/granted one.
export async function invokeIn<T = unknown>(
    scope: string | undefined,
    channel: string,
    ...args: unknown[]
): Promise<T> {
    const transport = getTransport(scope);
    await transport.ensureConnected();

    const route = RPC_ROUTES[channel];
    if (route) {
        const params: Record<string, unknown> = route.params
            ? route.params(args)
            : ((args[0] as Record<string, unknown>) ?? {});
        // route.timeoutMs overrides the default: null means "no timeout" —
        // panel-uninstall must never reject while the daemon is still
        // shredding a panel past the default 30s
        const timeoutMs =
            route.timeoutMs !== undefined
                ? route.timeoutMs
                : DEFAULT_ROUTE_TIMEOUT_MS;
        const result = await transport.call(route.action, params, timeoutMs);
        return route.unwrap ? route.unwrap(result) : result;
    }

    return invokeSpecial(channel, args, scope) as Promise<T>;
}

export async function invoke<T = unknown>(
    channel: string,
    ...args: unknown[]
): Promise<T> {
    return invokeIn<T>(undefined, channel, ...args);
}

// fire-and-forget channels log failures, never drop them; the returned
// promise is already failure-caught, so callers MAY await it (e.g.
// terminal.create) but existing fire-and-forget callers keep working
export function send(channel: string, ...args: unknown[]): Promise<void> {
    const t = getTransport();
    switch (channel) {
        case "terminal-create": {
            const p = args[0] as any;
            return t
                .ensureConnected()
                .then(() => t.call("term:create", p))
                .then(() => t.trackTerminal(p.id))
                .catch((err) => debugErr(`terminal-create ${p?.id}`, err));
        }
        case "terminal-write":
            return t.call("term:write", args[0] as any).catch((err) =>
                debugErr("terminal-write", err),
            );
        case "terminal-resize":
            return t.call("term:resize", args[0] as any).catch((err) =>
                debugErr("terminal-resize", err),
            );
        case "terminal-destroy": {
            const { id } = args[0] as any;
            t.untrackTerminal(id);
            // the resource is gone: the ledger dies with it, so a later
            // resubscribe attaches fresh instead of seeing a stale count
            dropAttachmentLedger("terminal", id, t);
            return t.call("term:destroy", { id }).catch((err) =>
                debugErr(`terminal-destroy ${id}`, err),
            );
        }
        case "process-write":
            return t.call("process:write", args[0] as any).catch((err) =>
                debugErr("process-write", err),
            );
        case "process-kill": {
            const { id } = args[0] as any;
            t.untrackProcess(id);
            dropAttachmentLedger("process", id, t);
            return t.call("process:kill", args[0] as any).catch((err) =>
                debugErr(`process-kill ${id}`, err),
            );
        }
        default:
            throw new Error(`[paperapi] IPC channel not allowed: ${channel}`);
    }
}

export function on(
    channel: string,
    listener: (event: any, ...args: any[]) => void,
): () => void {
    // Stream channels look like "<kind>:<resource-id>"
    const colonIndex = channel.indexOf(":");
    const kind = colonIndex === -1 ? channel : channel.slice(0, colonIndex);
    const suffix = colonIndex === -1 ? "" : channel.slice(colonIndex + 1);

    const route = WS_EVENTS[kind];
    if (!route) {
        throw new Error(`[paperapi] IPC channel not allowed: ${channel}`);
    }

    const t = getTransport();
    const wrapped = (payload: any) => {
        try {
            if (route.match && !route.match(payload ?? {}, suffix)) return;
            const cbArgs = route.transform
                ? route.transform(payload ?? {})
                : [];
            listener({} as any, ...cbArgs);
        } catch (err) {
            debugErr(`listener for ${channel}`, err);
        }
    };

    t.subscribeSource(route.source, wrapped);

    // eager connect so streams flow before first invoke
    t.ensureConnected().catch((err) => debugErr("stream eager connect", err));

    // replay attachments this client owns — refcounted per resource id:
    // multiple subscribers to the same id share ONE attachment (one remote
    // attach RPC, one replay entry), so an unsubscribe only tears down when
    // the LAST subscriber leaves. Per-subscriber attach/untrack pairs
    // previously untracked on the first unsubscribe while a listener
    // remained, silently losing reconnect replay.
    const tracked: "terminal" | "process" | null =
        kind === "terminal-data"
            ? "terminal"
            : kind === "process-data" ||
                kind === "process-stdout" ||
                kind === "process-stderr"
            ? "process"
            : null;
    if (tracked) {
        attachRefcounts(tracked, suffix, t);
    }

    return () => {
        t.unsubscribeSource(route.source, wrapped);
        if (tracked) {
            releaseAttachment(tracked, suffix, t);
        }
    };
}

// attach refcount ledger keyed PER TRANSPORT, then BY RESOURCE
// (${tracked}:${id}) — the ONE place "one live attachment per resource" is
// implemented. count>0 means the transport tracks and the daemon has been
// asked to attach. All three process channel kinds map to the same
// "process" resource key. Per-transport keying matters: transports are
// per-scope and replaceable (closeTransport drops the whole instance), and
// a transport-global ledger would leak refcounts into a replacement
// transport, which would then silently never re-attach. A WeakMap entry
// dies with its transport, so the ledger needs no teardown hook.
const attachRefs = new WeakMap<
    CraneTransport,
    Map<string, number>
>();

function ledgerFor(t: CraneTransport): Map<string, number> {
    let ledger = attachRefs.get(t);
    if (!ledger) {
        ledger = new Map();
        attachRefs.set(t, ledger);
    }
    return ledger;
}

function attachRefcounts(
    tracked: "terminal" | "process",
    id: string,
    t: ReturnType<typeof getTransport>,
): void {
    const ledger = ledgerFor(t);
    const key = `${tracked}:${id}`;
    const count = (ledger.get(key) ?? 0) + 1;
    ledger.set(key, count);
    if (count > 1) return; // attachment already live; nothing to redo
    if (tracked === "terminal") {
        t.call("term:attach", { id }).catch((err) =>
            debugErr(`term:attach ${id}`, err),
        );
        t.trackTerminal(id);
    } else {
        t.call("process:attach", { id }).catch((err) =>
            debugErr(`process:attach ${id}`, err),
        );
        t.trackProcess(id);
    }
    // a failed attach still had the id tracked so reconnect replays it; the
    // attach retry rides the daemon's own attach semantics
}

function releaseAttachment(
    tracked: "terminal" | "process",
    id: string,
    t: ReturnType<typeof getTransport>,
): void {
    const ledger = ledgerFor(t);
    const key = `${tracked}:${id}`;
    const count = ledger.get(key);
    if (count === undefined || count <= 1) {
        ledger.delete(key);
        if (tracked === "terminal") t.untrackTerminal(id);
        else t.untrackProcess(id);
        return;
    }
    ledger.set(key, count - 1);
}

// a destroyed/kill'ed resource tears its ledger entry down so a later
// resubscribe re-attaches fresh instead of inheriting a stale count
function dropAttachmentLedger(
    tracked: "terminal" | "process",
    id: string,
    t?: ReturnType<typeof getTransport>,
): void {
    ledgerFor(t ?? getTransport()).delete(`${tracked}:${id}`);
}
