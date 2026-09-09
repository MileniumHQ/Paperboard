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

// strict origin allowlist, exact hostname match
export function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    const lower = origin.toLowerCase();
    // custom schemes have an opaque origin of scheme://
    if (
        lower.startsWith("vscode-webview:") ||
        lower.startsWith("electron:") ||
        lower.startsWith("paperboard:") ||
        lower.startsWith("panel:") ||
        lower.startsWith("board:") ||
        lower.startsWith("file:")
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
    } catch {
        return false;
    }
}

// WebSocket RPC server
/** Per-connection tunnels to paired remotes */
interface TunnelOptions {
    remotesFile?: string;
    staticToken?: string | null;
}

export function setupWebSocketServer(
    wss: WebSocketServer,
    engine: PaperCraneEngine,
    auth: PaperCraneAuth,
    options: TunnelOptions = {},
) {
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

        // tunnels to paired remotes, keyed by tunnel id
        const tunnels = new Map<string, UpstreamWebSocket>();

        const sendEvent = (event: string, payload: any) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "event", event, payload }));
            }
        };

        const broadcastEvent = (event: string, payload: any) => {
            const msg = JSON.stringify({ type: "event", event, payload });
            for (const client of wss.clients) {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            }
        };

        ws.on("close", () => {
            const registryChanged = actionsRegistry.handleSocketClose(ws);
            if (registryChanged) {
                broadcastEvent("actions:registry-updated", { type: "socket:closed" });
            }
            for (const upstream of tunnels.values()) {
                try {
                    upstream.close();
                } catch {}
            }
            tunnels.clear();
        });

        ws.on("message", async (raw: any) => {
            // kept for the catch below so failures always answer
            let failedId: unknown = null;
            try {
                let text = raw.toString("utf8");
                const maybe = JSON.parse(text);

                // action replies from background services
                if (maybe && typeof maybe === "object" && maybe.type === "action_reply") {
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
                    const tunnelId = maybe.tunnelId ?? maybe.id;
                    const computerId = maybe.computerId;
                    const entry = readRemotes(options.remotesFile).find(
                        (r) => r.id === computerId || r.name === computerId,
                    );
                    if (!entry) {
                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "unknown-computer" }));
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
                                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "auth-failed" }));
                                        upstream.close();
                                        tunnels.delete(tunnelId);
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
                            tunnels.delete(tunnelId);
                            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId }));
                        });
                        upstream.on("error", (err) => {
                            logger.debug(
                                `[tunnel ${tunnelId}] upstream connection error:`,
                                err,
                            );
                            tunnels.delete(tunnelId);
                            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "unreachable" }));
                        });
                    } catch (err: any) {
                        ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: err?.message || "error" }));
                    }
                    return;
                }

                if (maybe && typeof maybe === "object" && maybe.type === "remote:close") {
                    const upstream = tunnels.get(maybe.id);
                    if (upstream) {
                        tunnels.delete(maybe.id);
                        upstream.close();
                    }
                    return;
                }

                const msg = maybe;
                try {
                    failedId = (msg as any)?.id ?? null;
                } catch {}
                const { id, action, params } = msg;

                const reply = (result: any, error?: string) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "response", id, result, error }));
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
                    sendEvent,
                    broadcastEvent,
                    reply: (rid: unknown, result: any, error?: string) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: "response", id: rid, result, error }));
                        }
                    },
                };

                // auth handshake
                if (action === "auth:pair") {
                    const result = auth.pair(params?.code, params?.clientName);
                    if (result.success && result.token) {
                        isAuthenticated = true;
                        const osInfo = getDetailedOsInfo();
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
                    const valid = auth.verifyToken(params?.token);
                    if (valid) {
                        isAuthenticated = true;
                        authedToken = params?.token ?? null;
                        const osInfo = getDetailedOsInfo();
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
                        reply(null, "Invalid authentication token");
                    }
                    return;
                }

                if (!isAuthenticated) {
                    if (params?.token && auth.verifyToken(params.token)) {
                        isAuthenticated = true;
                        authedToken = params.token;
                    } else {
                        reply(null, "Unauthorized. Authentication required.");
                        return;
                    }
                }

                // revoke-self is socket-bound, no token parameter
                if (action === "auth:revoke-self") {
                    if (!authedToken) {
                        reply(null, "Unauthorized. Authentication required.");
                        return;
                    }
                    const revoked = auth.revokeToken(authedToken);
                    authedToken = null;
                    isAuthenticated = false;
                    reply({ revoked });
                    return;
                }

                if (
                    (await handleTerminal(action, id, params, rpcCtx)) ||
                    (await handleProcess(action, id, params, rpcCtx)) ||
                    (await handleFiles(action, id, params, rpcCtx)) ||
                    (await handlePackages(action, id, params, rpcCtx)) ||
                    (await handlePanels(action, id, params, rpcCtx)) ||
                    (await handleActions(action, id, params, rpcCtx)) ||
                    (await handleSystem(action, id, params, rpcCtx))
                ) {
                    return;
                }
                reply(null, `Unknown action: ${action}`);
            } catch (err: any) {
                // always answer with a sanitized message, never a stack
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                type: "response",
                                id: failedId,
                                result: null,
                                error: `Request failed: ${err?.message || "internal error"}`,
                            }),
                        );
                    }
                } catch {}
                console.error("[PaperCrane:RPC:Error]", err?.message || err);
            }
        });
    });
}
