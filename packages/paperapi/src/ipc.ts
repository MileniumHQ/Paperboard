// transport router, every channel rides the WebSocket
import { CraneTransport, ambientScope } from "./ws";
import { debugErr } from "./debug";
import { REGISTRY_URL } from "./config";

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

// panel id is hostname after first dot, or env in Node/service runtimes
export function getPanelId(): string {
    if (typeof window !== "undefined" && window.location) {
        const host = window.location.hostname || "";
        const dot = host.indexOf(".");
        if (dot < 0) return host;
        return host.slice(dot + 1);
    }
    if (typeof process !== "undefined" && process.env?.PAPERBOARD_PANEL_ID) {
        return process.env.PAPERBOARD_PANEL_ID;
    }
    return "";
}

// ─── Transport registry ──────────────────────────────────────────────────────

// one transport per computer, bound at creation
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

// re-init reuses the existing transport
export function initPaperApi(opts: InitOptions = {}): Promise<void> {
    const scope = opts.computerId || ambientScope();
    if (!transports.has(scope)) {
        const transport = new CraneTransport(opts);
        if (hasIpc() && !transport.credentialProvider) {
            transport.credentialProvider = createShellCredentialProvider();
        }
        transports.set(scope, transport);
    } else if (
        opts.port ||
        opts.token ||
        opts.computerId ||
        opts.craneJsonPath
    ) {
        console.warn(
            "[paperapi] initPaperApi called after bootstrap; transport options ignored",
        );
    }
    return getTransport(scope).ensureConnected();
}

function createShellCredentialProvider(): NonNullable<
    CraneTransport["credentialProvider"]
> {
    return async () =>
        await getElectronIpc()!.invoke<{
            port: number;
            token: string;
        }>("crane-credentials");
}

// ─── Channel translation ─────────────────────────────────────────────────────

interface WsRoute {
    action: string;
    params?: (args: any[]) => Record<string, unknown>;
    unwrap?: (result: any) => any;
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
        // Bare-string invoke: invoke("config-get", id)
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
            } catch (err) {
                debugErr("panel-install registry lookup", err);
            }
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

        case "process-start": {
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

        case "process-run": {
            const p = args[0] as any;
            const res = await t.call("process:run", {
                id: p.id,
                command: p.command,
                args: p.args || [],
                cwd: p.cwd,
                env: p.env,
            });
            t.trackProcess(p.id);
            return res;
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

// route to the named computer, undefined = ambient
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
                .catch((err) => debugErr(`terminal-create ${p?.id}`, err));
            return;
        }
        case "terminal-write":
            t.call("term:write", args[0] as any).catch((err) =>
                debugErr("terminal-write", err),
            );
            return;
        case "terminal-resize":
            t.call("term:resize", args[0] as any).catch((err) =>
                debugErr("terminal-resize", err),
            );
            return;
        case "terminal-destroy": {
            const { id } = args[0] as any;
            t.call("term:destroy", { id }).catch((err) =>
                debugErr(`terminal-destroy ${id}`, err),
            );
            t.untrackTerminal(id);
            return;
        }
        case "process-write":
            t.call("process:write", args[0] as any).catch((err) =>
                debugErr("process-write", err),
            );
            return;
        case "process-kill": {
            const { id } = args[0] as any;
            t.call("process:kill", args[0] as any).catch((err) =>
                debugErr(`process-kill ${id}`, err),
            );
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

    // replay attachments this client owns
    let tracked: "terminal" | "process" | null = null;
    if (kind === "terminal-data") {
        t.call("term:attach", { id: suffix }).catch((err) =>
            debugErr(`term:attach ${suffix}`, err),
        );
        t.trackTerminal(suffix);
        tracked = "terminal";
    } else if (
        kind === "process-data" ||
        kind === "process-stdout" ||
        kind === "process-stderr"
    ) {
        t.call("process:attach", { id: suffix }).catch((err) =>
            debugErr(`process:attach ${suffix}`, err),
        );
        t.trackProcess(suffix);
        tracked = "process";
    }

    return () => {
        t.unsubscribeSource(route.source, wrapped);
        if (tracked === "terminal") t.untrackTerminal(suffix);
        else if (tracked === "process") t.untrackProcess(suffix);
    };
}
