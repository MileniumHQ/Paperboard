// PaperAPI transport router.
//
// Public surface (invoke/send/on/unpackIpcPayload) is unchanged from the
// original Electron-only bridge, so every namespace module works without
// modification. Under the hood, ALL channels ride the PaperCrane WebSocket
// transport. PaperAPI never touches Electron IPC — privileged shell
// orchestration lives in the shell itself.
//
// Bootstrap resolves daemon credentials from the host (panel://__crane,
// preload bridge) or the local handshake file (node builds).

import { CraneTransport, ambientScope } from "./ws";

export interface IpcRendererLike {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    send(channel: string, ...args: unknown[]): void;
    on(
        channel: string,
        listener: (event: any, ...args: any[]) => void,
    ): (() => void) | void;
    once?(channel: string, listener: (event: any, ...args: any[]) => void): void;
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

export function getElectronIpc(): IpcRendererLike | undefined {
    if (typeof window === "undefined") return undefined;
    return window.electron?.ipcRenderer ?? window.ipcRenderer;
}

function hasIpc(): boolean {
    return !!getElectronIpc();
}

export function unpackIpcPayload<T>(event: unknown, data: T): T | unknown {
    return data !== undefined ? data : event;
}

// ─── Transport registry ──────────────────────────────────────────────────────
//
// One transport PER COMPUTER, created on demand and bound to that computer
// forever. There is deliberately no "active transport" and no retargeting:
// code that talks to a computer names it, so data can never land on the
// wrong machine. Panels resolve their scope from their iframe's ?comp=
// bootstrap parameter (ambientScope()); the shell passes explicit scopes.

const transports = new Map<string, CraneTransport>();

export function getTransport(scope?: string): CraneTransport {
    const id = scope || ambientScope();
    let transport = transports.get(id);
    if (!transport) {
        transport = new CraneTransport({ computerId: id });
        if (hasIpc() && !transport.credentialProvider) {
            transport.credentialProvider = createShellCredentialProvider();
        }
        transports.set(id, transport);
    }
    return transport;
}

export interface InitOptions {
    port?: number;
    token?: string;
    computerId?: string;
    /** Node-only: explicit handshake file location. */
    craneJsonPath?: string;
}

// Explicit initialization. Optional — without it the first API call triggers
// automatic bootstrap appropriate for the runtime.
//
// The default transport is permanent: re-initialization reuses the existing
// instance and only warns about ignored options.
export function initPaperApi(opts: InitOptions = {}): Promise<void> {
    const scope = opts.computerId || ambientScope();
    if (!transports.has(scope)) {
        const transport = new CraneTransport(opts);
        if (hasIpc() && !transport.credentialProvider) {
            transport.credentialProvider = createShellCredentialProvider();
        }
        transports.set(scope, transport);
    } else if (opts.port || opts.token || opts.computerId || opts.craneJsonPath) {
        console.warn(
            "[paperapi] initPaperApi called after bootstrap; transport options ignored",
        );
    }
    return getTransport(scope).ensureConnected();
}

function createShellCredentialProvider(): NonNullable<CraneTransport["credentialProvider"]> {
    return async () =>
        await getElectronIpc()!.invoke<{
            port: number;
            token: string;
        }>("crane-credentials");
}

// ─── Channel translation ─────────────────────────────────────────────────────

const REGISTRY_URL =
    (typeof process !== "undefined" && process.env?.ORIGAMI_REGISTRY_URL) ||
    "https://origami.ariapis.com";

interface WsRoute {
    action: string;
    params?: (args: any[]) => Record<string, unknown>;
    unwrap?: (result: any) => any;
    /** null = no timeout (long-running operations) */
    timeoutMs?: number | null;
}

const WS_INVOKE: Record<string, WsRoute> = {
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
        // Legacy signature: invoke("config-get", id)
        action: "config:get",
        params: (args) => ({ id: args[0] }),
        unwrap: (r) => r.data,
    },
    "config-set": {
        action: "config:set",
        unwrap: (r) => r.success,
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
        // Legacy signature: invoke("package-get-path", packageName)
        action: "package:getPath",
        params: (args) => ({ packageName: args[0] }),
        unwrap: (r) => r.path,
    },
    "panels-list": {
        action: "panel:list",
        unwrap: (r) => r.panels ?? [],
    },
    "panel-uninstall": {
        // Legacy signature: invoke("panel-uninstall", panelId)
        action: "panel:uninstall",
        params: (args) => ({ panelId: args[0] }),
        unwrap: (r) => r.success ?? true,
        timeoutMs: null,
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
};

// Channels needing bespoke logic (progress subscriptions, registry lookups)
const LONG_TIMEOUT = null;

async function invokeSpecial(channel: string, args: any[], scope?: string): Promise<any> {
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
            });
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
            let sha256: string | undefined;
            let signature: string | undefined;
            let version: string | undefined;
            try {
                const res = await fetch(`${REGISTRY_URL}/panels/index.json`);
                if (res.ok) {
                    const record = (await res.json())?.[panelId];
                    sha256 = record?.sha256;
                    signature = record?.signature;
                    version = record?.version;
                }
            } catch {}
            const result = await t.call(
                "panel:install",
                {
                    panelId,
                    downloadUrl: `${REGISTRY_URL}/panel/${panelId}/download`,
                    sha256,
                    signature,
                    version,
                },
                LONG_TIMEOUT,
            );
            return result.panel;
        }

        case "process-start":
        case "process-run": {
            const p = args[0] as any;
            await t.call("process:run", {
                id: p.id,
                command: p.command,
                args: p.args || [],
                cwd: p.cwd,
                env: p.env,
            });
            t.trackProcess(p.id);
            return { success: true };
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

// Scoped invocation: routes the channel to the transport of the named
// computer. `undefined` means the ambient scope (panel bootstrap param or
// "local"). This is the ONLY way multi-computer clients address a computer.
export async function invokeIn<T = unknown>(
    scope: string | undefined,
    channel: string,
    ...args: unknown[]
): Promise<T> {
    const transport = getTransport(scope);
    await transport.ensureConnected();

    const route = WS_INVOKE[channel];
    if (route) {
        const params: Record<string, unknown> = route.params
            ? route.params(args)
            : ((args[0] as Record<string, unknown>) ?? {});
        const result = await transport.call(route.action, params);
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

export function send(channel: string, ...args: unknown[]): void {
    const t = getTransport();
    switch (channel) {
        case "terminal-create": {
            const p = args[0] as any;
            t.ensureConnected()
                .then(() => t.call("term:create", p))
                .then(() => t.trackTerminal(p.id))
                .catch(() => {});
            return;
        }
        case "terminal-write":
            t.call("term:write", args[0] as any).catch(() => {});
            return;
        case "terminal-resize":
            t.call("term:resize", args[0] as any).catch(() => {});
            return;
        case "terminal-destroy": {
            const { id } = args[0] as any;
            t.call("term:destroy", { id }).catch(() => {});
            t.untrackTerminal(id);
            return;
        }
        case "process-write":
            t.call("process:write", args[0] as any).catch(() => {});
            return;
        case "process-kill": {
            const { id } = args[0] as any;
            t.call("process:kill", args[0] as any).catch(() => {});
            t.untrackProcess(id);
            return;
        }
        default:
            throw new Error(`[paperapi] IPC channel not allowed: ${channel}`);
    }
}

export function on(
    channel: string,
    listener: (event: any, ...args: any[]) => void,
): (() => void) | void {
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
            const cbArgs = route.transform ? route.transform(payload ?? {}) : [];
            listener({} as any, ...cbArgs);
        } catch {}
    };

    t.subscribeSource(route.source, wrapped);

    // Eager connect so streams start flowing even before an invoke
    t.ensureConnected().catch(() => {});

    // Best-effort replay for terminals/processes this client owns
    if (kind === "terminal-data") {
        t.call("term:attach", { id: suffix }).catch(() => {});
        t.trackTerminal(suffix);
    } else if (kind === "process-data" || kind === "process-stdout" || kind === "process-stderr") {
        t.call("process:attach", { id: suffix }).catch(() => {});
        t.trackProcess(suffix);
    }

    // No explicit off() in the legacy surface; subscriptions live for the
    // page lifetime, and transport reconnects replay them automatically.
}
