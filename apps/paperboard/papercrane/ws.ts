import { WebSocketServer, WebSocket } from "ws";
import * as os from "os";
import { WebSocket as UpstreamWebSocket } from "ws";
import { PaperCraneEngine } from "./engine";
import { PaperCraneAuth } from "./auth";
import { readRemotes } from "./remotes";
import { getDetailedOsInfo } from "./index";
import { logger } from "./logger";
import { actionsRegistry } from "./actions";
import type { RpcContext } from "./rpc/context";
import { handleTerminal } from "./rpc/terminal";
import { handleProcess } from "./rpc/process";
import { handleFiles } from "./rpc/files";
import { handlePackages } from "./rpc/packages";
import { handlePanels } from "./rpc/panels";
import { handleActions } from "./rpc/actions";
import { handleSystem } from "./rpc/system";
import { handleSecrets } from "./rpc/secrets";
import { PROTOCOL_VERSION, ErrorCode } from "./protocol";
import { rpcErrorCode } from "./rpc/params";

// strict origin allowlist, exact hostname match
export function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    const lower = origin.toLowerCase();
    // custom schemes have an opaque origin of scheme://. file:// is NOT
    // served: any HTML file opened locally could otherwise hold a WS
    // origin the daemon binds 0.0.0.0 for — the token still gates every
    // call, but the scheme allowlist shouldn't invite it.
    if (
        lower.startsWith("vscode-webview:") ||
        lower.startsWith("electron:") ||
        lower.startsWith("paperboard:") ||
        lower.startsWith("panel:") ||
        lower.startsWith("board:")
    ) {
        return true;
    }
    try {
        const url = new URL(lower);
        return (
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "::1" ||
            url.hostname === "[::1]"
        );
    } catch (err) {
        // unparseable origin fails closed (deny) — logged so a flood of
        // denies stays diagnosable instead of mysterious
        logger.debug("[ws] origin allowlist parse failed, denying:", err);
        return false;
    }
}

// WebSocket RPC server
/** Per-connection tunnels to paired remotes */
interface TunnelOptions {
    remotesFile?: string;
    staticToken?: string | null;
}

// per-socket broadcast interest is opt-in: a socket that never declares an
// events:subscribe list receives no broadcast event frames at all
const MAX_EVENT_SUBS = 512;

// per-socket tunnel cap: each tunnel is a live upstream socket, so an
// authenticated socket may not open an unbounded number of them
const MAX_TUNNELS_PER_SOCKET = 32;

export function setupWebSocketServer(
    wss: WebSocketServer,
    engine: PaperCraneEngine,
    auth: PaperCraneAuth,
    options: TunnelOptions = {},
) {
    // broadcast interest per socket: socket → declared event names
    const socketSubscriptions = new Map<WebSocket, Set<string>>();

    wss.on("connection", (ws: WebSocket, req: any) => {
        const origin = (req.headers.origin || "").toLowerCase();
        // absent Origin is a non-browser client, browsers always send one
        if (origin && !isAllowedOrigin(origin)) {
            ws.close(4403, "Forbidden Origin");
            return;
        }

        let isAuthenticated = Boolean(auth.noAuth);
        // token for this socket, revoke-self only revokes this one
        let authedToken: string | null = null;
        // granted panel identity for this socket (token claim, never a
        // caller parameter). Null = full-authority master/host caller.
        let authedPanelId: string | null = null;

        // tunnels to paired remotes, keyed by tunnel id
        const tunnels = new Map<string, UpstreamWebSocket>();

        // one teardown shape for every tunnel exit: map removal lives
        // here, not scattered across event handlers. Notify-once falls out
        // of the early return — a late upstream close after an error (or
        // after the local socket died) cannot emit a second tunnel-closed.
        const closeTunnel = (
            tunnelId: string,
            opts: { reason?: string; notify?: boolean } = {},
        ): void => {
            const upstream = tunnels.get(tunnelId);
            if (!upstream) return;
            tunnels.delete(tunnelId);
            try {
                upstream.close();
            } catch (err) {
                logger.debug(`[tunnel ${tunnelId}] close failed:`, err);
            }
            if (opts.notify !== false && ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: "tunnel-closed",
                        id: tunnelId,
                        ...(opts.reason ? { reason: opts.reason } : {}),
                    }),
                );
            }
        };

        const sendEvent = (event: string, payload: any) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "event", event, payload }));
            }
        };

        const broadcastEvent = (event: string, payload: any) => {
            const msg = JSON.stringify({ type: "event", event, payload });
            for (const client of wss.clients) {
                if (client.readyState !== WebSocket.OPEN) continue;
                // scope broadcasts to sockets that declared interest; a socket
                // that never subscribed gets nothing, closing the blast radius
                const subs = socketSubscriptions.get(client);
                if (subs && (subs.has(event) || subs.has("*"))) {
                    client.send(msg);
                }
            }
        };

        ws.on("close", () => {
            socketSubscriptions.delete(ws);
            const registryChanged = actionsRegistry.handleSocketClose(ws);
            if (registryChanged) {
                broadcastEvent("actions:registry-updated", { type: "socket:closed" });
            }
            // the socket is dead: close upstreams, notify no one
            for (const id of [...tunnels.keys()]) {
                closeTunnel(id, { notify: false });
            }
        });

        ws.on("message", async (raw: any) => {
            // kept for the catch below so failures always answer
            let failedId: unknown = null;
            try {
                let text = raw.toString("utf8");
                const maybe = JSON.parse(text);

                // action replies from background services — only from
                // authenticated sockets, so an unauthenticated LAN peer
                // cannot inject results into another socket's pending calls
                if (maybe && typeof maybe === "object" && maybe.type === "action_reply") {
                    if (!isAuthenticated) {
                        logger.debug("[ws] dropping pre-auth action_reply frame");
                        return;
                    }
                    actionsRegistry.handleReply(maybe.callId, maybe.result, maybe.error);
                    return;
                }

                // tunneled frames bypass the local pipeline
                if (maybe && typeof maybe === "object" && maybe.type === "tunnel") {
                    const upstream = tunnels.get(maybe.id);
                    if (upstream && upstream.readyState === UpstreamWebSocket.OPEN) {
                        upstream.send(typeof maybe.payload === "string" ? maybe.payload : JSON.stringify(maybe.payload));
                    }
                    return;
                }

                if (maybe && typeof maybe === "object" && maybe.type === "remote:open") {
                    // relaying uses the host's stored remote token — an
                    // unauthenticated LAN socket must never be able to open
                    // one. background-service sockets authenticate at attach,
                    // so the legit path is unaffected.
                    if (!isAuthenticated) {
                        const refusedId = maybe.tunnelId ?? maybe.id ?? null;
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: "response",
                                id: refusedId,
                                result: null,
                                error: "Unauthorized. Authentication required.",
                                code: ErrorCode.AUTH_REQUIRED,
                            }));
                        }
                        return;
                    }
                    const tunnelId = maybe.tunnelId ?? maybe.id;
                    const computerId = maybe.computerId;
                    // identity first: exact id match wins. A bare name only
                    // resolves when it is unambiguous — with two remotes
                    // sharing a name, first-match-wins could tunnel to the
                    // wrong machine, so refuse instead of guessing.
                    const candidates = readRemotes(options.remotesFile).filter(
                        (r) => r.id === computerId || r.name === computerId,
                    );
                    const entry =
                        candidates.find((r) => r.id === computerId) ??
                        (candidates.length === 1 ? candidates[0] : undefined);
                    if (!entry) {
                        ws.send(JSON.stringify({
                            type: "tunnel-closed",
                            id: tunnelId,
                            reason: candidates.length > 1 ? "ambiguous-computer" : "unknown-computer",
                        }));
                        return;
                    }
                    if (tunnels.size >= MAX_TUNNELS_PER_SOCKET) {
                        ws.send(JSON.stringify({
                            type: "tunnel-closed",
                            id: tunnelId,
                            reason: "too-many-tunnels",
                        }));
                        return;
                    }
                    try {
                        const upstream = new UpstreamWebSocket(`ws://${entry.host}:${entry.port}`);
                        tunnels.set(tunnelId, upstream);
                        upstream.on("open", () => {
                            upstream.send(JSON.stringify({
                                id: "__tunnel-auth",
                                action: "auth:verify",
                                params: { token: entry.token },
                            }));
                        });
                        upstream.on("message", (data: any) => {
                            if (upstream.readyState !== UpstreamWebSocket.OPEN) return;
                            try {
                                const m = JSON.parse(data.toString("utf8"));
                                if (m?.id === "__tunnel-auth") {
                                    if (m.error) {
                                        closeTunnel(tunnelId, { reason: "auth-failed" });
                                    } else {
                                        ws.send(JSON.stringify({ type: "tunnel-open", id: tunnelId }));
                                    }
                                    return;
                                }
                            } catch (err) {
                                // non-JSON frames during handshake, logged for diagnosis
                                logger.debug(
                                    `[tunnel ${tunnelId}] non-JSON frame during auth handshake:`,
                                    err,
                                );
                            }
                            ws.send(JSON.stringify({ type: "tunnel", id: tunnelId, payload: data.toString("utf8") }));
                        });
                        upstream.on("close", () => {
                            closeTunnel(tunnelId);
                        });
                        upstream.on("error", (err) => {
                            logger.debug(
                                `[tunnel ${tunnelId}] upstream connection error:`,
                                err,
                            );
                            closeTunnel(tunnelId, { reason: "unreachable" });
                        });
                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: err?.message || "error" }));
                    }
                    return;
                }

                if (maybe && typeof maybe === "object" && maybe.type === "remote:close") {
                    // client-initiated: tear down silently, no echo frame
                    closeTunnel(maybe.id, { notify: false });
                    return;
                }

                const msg = maybe;
                try {
                    failedId = (msg as any)?.id ?? null;
                } catch (err) { logger.debug("[ws.ts] op failed:", err) }
                const { id, action, params } = msg;

                const reply = (
                    result: any,
                    error?: string,
                    code?: string,
                ) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                type: "response",
                                id,
                                result,
                                error,
                                ...(code ? { code } : {}),
                            }),
                        );
                    }
                };

                const rpcCtx: RpcContext = {
                    wss,
                    ws,
                    engine,
                    auth,
                    isAuthenticated: () => isAuthenticated,
                    setAuthenticated: (v: boolean) => {
                        isAuthenticated = v;
                    },
                    callerPanelId: () => authedPanelId,
                    sendEvent,
                    broadcastEvent,
                    reply: (
                        rid: unknown,
                        result: any,
                        error?: string,
                        code?: string,
                    ) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(
                                JSON.stringify({
                                    type: "response",
                                    id: rid,
                                    result,
                                    error,
                                    ...(code ? { code } : {}),
                                }),
                            );
                        }
                    },
                };

                // protocol version: warn-once per socket for frameless
                // clients, refuse hard mismatches with a typed error
                if (params?.v !== undefined && params.v !== PROTOCOL_VERSION) {
                    reply(
                        null,
                        `Protocol version mismatch: daemon speaks ${PROTOCOL_VERSION}, client offered ${params.v}`,
                        ErrorCode.BAD_PROTOCOL,
                    );
                    return;
                }

                // auth handshake
                if (action === "auth:pair") {
                    const result = auth.pair(params?.code, params?.clientName);
                    if (result.success && result.token) {
                        isAuthenticated = true;
                        const osInfo = await getDetailedOsInfo();
                        reply({
                            success: true,
                            token: result.token,
                            hostname: os.hostname().replace(/\.local$/i, ""),
                            os: osInfo.os,
                            osVersion: osInfo.osVersion,
                            distroId: osInfo.distroId,
                            distroName: osInfo.distroName,
                            arch: process.arch,
                        });
                    } else {
                        reply(null, result.error || "Pairing failed");
                    }
                    return;
                }

                if (action === "auth:verify") {
                    const entry = auth.resolveToken(params?.token);
                    const valid = auth.noAuth || entry !== null;
                    if (valid) {
                        isAuthenticated = true;
                        authedToken = params?.token ?? null;
                        authedPanelId = entry?.panelId ?? null;
                        const osInfo = await getDetailedOsInfo();
                        reply({
                            success: true,
                            hostname: os.hostname().replace(/\.local$/i, ""),
                            os: osInfo.os,
                            osVersion: osInfo.osVersion,
                            distroId: osInfo.distroId,
                            distroName: osInfo.distroName,
                            arch: process.arch,
                        });
                    } else {
                        reply(null, "Invalid authentication token", ErrorCode.AUTH_REQUIRED);
                    }
                    return;
                }

                if (!isAuthenticated) {
                    if (params?.token) {
                        const entry = auth.resolveToken(params.token);
                        if (entry !== null || auth.noAuth) {
                            isAuthenticated = true;
                            authedToken = params.token;
                            authedPanelId = entry?.panelId ?? null;
                        } else {
                            reply(null, "Unauthorized. Authentication required.", ErrorCode.AUTH_REQUIRED);
                            return;
                        }
                    } else {
                        reply(null, "Unauthorized. Authentication required.", ErrorCode.AUTH_REQUIRED);
                        return;
                    }
                }

                // revoke-self is socket-bound, no token parameter
                if (action === "auth:revoke-self") {
                    if (!authedToken) {
                        reply(null, "Unauthorized. Authentication required.", ErrorCode.AUTH_REQUIRED);
                        return;
                    }
                    const revoked = auth.revokeToken(authedToken);
                    authedToken = null;
                    authedPanelId = null;
                    isAuthenticated = false;
                    reply({ revoked });
                    return;
                }

                // broadcast interest: full-replace declaration of the event
                // names this socket wants to receive. events:unsubscribe is
                // expressed as an empty list — one idempotent toggle.
                if (action === "events:subscribe") {
                    const events = params?.events;
                    if (!Array.isArray(events)) {
                        reply(null, "Missing required parameter: events (array)", ErrorCode.INVALID_PARAMS);
                        return;
                    }
                    if (events.length > MAX_EVENT_SUBS) {
                        reply(null, `Too many event subscriptions (max ${MAX_EVENT_SUBS})`, ErrorCode.INVALID_PARAMS);
                        return;
                    }
                    const declared = new Set<string>();
                    for (const evt of events) {
                        if (typeof evt === "string") declared.add(evt);
                    }
                    socketSubscriptions.set(ws, declared);
                    reply({ success: true, count: declared.size });
                    return;
                }

                if (
                    (await handleTerminal(action, id, params, rpcCtx)) ||
                    (await handleProcess(action, id, params, rpcCtx)) ||
                    (await handleFiles(action, id, params, rpcCtx)) ||
                    (await handlePackages(action, id, params, rpcCtx)) ||
                    (await handlePanels(action, id, params, rpcCtx)) ||
                    (await handleActions(action, id, params, rpcCtx)) ||
                    (await handleSystem(action, id, params, rpcCtx)) ||
                    (await handleSecrets(action, id, params, rpcCtx))
                ) {
                    return;
                }
                reply(null, `Unknown action: ${action}`, ErrorCode.NOT_FOUND);
            } catch (err: any) {
                // always answer with a sanitized message, never a stack.
                // malformed calls (rpc/params.ts asserts) get a typed
                // INVALID_PARAMS; everything else is INTERNAL.
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                type: "response",
                                id: failedId,
                                result: null,
                                error: `Request failed: ${err?.message || "internal error"}`,
                                code: rpcErrorCode(err),
                            }),
                        );
                    }
                } catch (replyErr) {
                    logger.debug("[Paperboard Server:RPC] error reply failed:", replyErr);
                }
                console.error("[Paperboard Server:RPC:Error]", err?.message || err);
            }
        });
    });
}
