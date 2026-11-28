import { WebSocketServer, WebSocket } from "ws";
import { PaperCraneEngine } from "../engine/index";
import { PaperCraneAuth } from "../security/auth";
import { logger } from "../core/logger";
import { blocksRegistry } from "./actions";
import type { RpcContext } from "../rpc/context";
import { rpcDispatcher } from "../rpc/dispatch";
import { terminalRpc } from "../rpc/terminal";
import { processRpc } from "../rpc/process";
import { filesRpc } from "../rpc/files";
import { packagesRpc } from "../rpc/packages";
import { panelsRpc } from "../rpc/panels";
import { blocksRpc } from "../rpc/blocks";
import { systemRpc } from "../rpc/system";
import { secretsRpc } from "../rpc/secrets";
import { backupServiceFor, backupsRpc } from "../rpc/backups";
import { portsRpc } from "../rpc/ports";
import { problemsFor, problemsRpc } from "../rpc/problems";
import { pagesRpc } from "../rpc/pages";
import { computersRpc } from "../rpc/computers";
import { sharedRpc } from "../rpc/shared";
import type { SharedDocuments } from "../network/shared";
import { SHARED_EVENT } from "@mileniumhq/paperapi/sharedShape";
import { PROTOCOL_VERSION, ErrorCode } from "../core/protocol";
import { panelId as panelIdShape, readParams, readValue } from "@mileniumhq/paperapi/protocol";
import { rpcErrorCode } from "../rpc/errors";
import { TrafficMonitor } from "./monitor";
import { secretsMatch } from "../security/secretCompare";
import { MONITOR_PROTOCOL, MONITOR_SUBSCRIBE, MONITOR_UNSUBSCRIBE } from "@mileniumhq/paperapi/monitorProtocol";
import { BACKUP_PROGRESS_EVENT } from "@mileniumhq/paperapi/channels";
import { PROBLEMS_EVENT } from "@mileniumhq/paperapi/problemShape";
import { HANDSHAKE_TIMEOUT_MS, MAX_WS_PAYLOAD, sendBounded } from "./wsFrames";
import { EventSubscriptions } from "./wsEvents";
import { SocketIdentities, SocketIdentity } from "./wsIdentity";
import { handleAuth } from "./wsAuth";
import { socketTunnels, type TunnelOptions } from "./wsTunnels";

export { MAX_WS_PAYLOAD };

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
            // *.localhost is loopback by definition (browsers never send it
            // to DNS); browser mode serves the shell and each panel there
            url.hostname.endsWith(".localhost") ||
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

// WebSocket RPC server: admission, identity, tunnels and auth live in the
// ws* modules; this wires them per socket and dispatches the RPC actions
// to rpc/*.
interface ServerOptions extends TunnelOptions {
    staticToken?: string | null;
    shared: SharedDocuments;
}

const MAX_CONNECTIONS = 4096;

// every action PaperAPI's protocol/rpc.ts declares, past the auth gate
const dispatch = rpcDispatcher([
    terminalRpc, processRpc, filesRpc, packagesRpc, panelsRpc, blocksRpc,
    systemRpc, secretsRpc, backupsRpc, portsRpc, problemsRpc, pagesRpc, computersRpc,
    sharedRpc,
]);
const MAX_IN_FLIGHT_PER_SOCKET = 1024;

export function setupWebSocketServer(
    wss: WebSocketServer,
    engine: PaperCraneEngine,
    auth: PaperCraneAuth,
    options: ServerOptions,
) {
    const identities = new SocketIdentities();
    let inFlightTotal = 0;
    // the traffic tap behind `paperapi monitor`; inert until a host subscribes
    const monitor = new TrafficMonitor((listener) => engine.onLifecycle(listener), sendBounded);
    const events = new EventSubscriptions(monitor);
    // a running backup's steps reach its panel and the shell
    const offBackupProgress = backupServiceFor(engine).onProgress((change) => events.deliver(BACKUP_PROGRESS_EVENT, change, null));
    // a panel's problems changed: the shell shows them by its name, and its page may follow its own
    const offProblems = problemsFor(engine).onChange((panelId, problems) => events.deliver(PROBLEMS_EVENT, { panelId, problems }, panelId));
    // the computer list changed: this computer's app asks for it again
    const offRoster = options.roster.onChange(() => events.deliver("computers:changed", {}, null));
    // shared documents changed: only their panel's sockets and the host's
    // hear it (the shell's documents, only the host's)
    const socketPanels = new WeakMap<WebSocket, SocketIdentity>();
    const offShared = options.shared.onChange((owner, ids) =>
        events.deliver(SHARED_EVENT, { panelId: owner.panelId, ids }, owner.panelId, (socket) => {
            const identity = socketPanels.get(socket);
            if (!identity || identity.relayTo !== null) return false;
            return identity.panelId === null || identity.panelId === owner.panelId;
        }),
    );
    wss.options.maxPayload = Math.min(wss.options.maxPayload ?? MAX_WS_PAYLOAD, MAX_WS_PAYLOAD);
    const revokeSockets = (sockets?: Set<WebSocket>) => {
        for (const socket of sockets ?? []) {
            events.forget(socket);
            socket.close(4401, "Credential revoked");
        }
    };
    const offRevocations = identities.watchRevocations(auth, revokeSockets);
    wss.once("close", () => {
        offRevocations();
        offBackupProgress();
        offProblems();
        offRoster();
        offShared();
        identities.clear();
        events.clear();
        monitor.clear();
    });

    wss.on("connection", (ws: WebSocket, req: any) => {
        // Parser errors happen before a message event; contain them here.
        ws.on("error", (err) => {
            logger.warn("[ws] connection refused/closed after socket error:", err.message);
            ws.terminate();
        });
        if (wss.clients.size > MAX_CONNECTIONS) {
            ws.close(4429, "Connection limit reached");
            return;
        }
        const origin = (req.headers.origin || "").toLowerCase();
        // absent Origin is a non-browser client, browsers always send one
        if (origin && !isAllowedOrigin(origin)) {
            ws.close(4403, "Forbidden Origin");
            return;
        }

        let inFlight = 0;
        let releasePreAuth: (() => void) | null = null;
        if (!auth.noAuth) {
            releasePreAuth = identities.admitPreAuth(String(req?.socket?.remoteAddress ?? ""));
            if (!releasePreAuth) {
                ws.close(4429, "Connection limit reached");
                return;
            }
        }
        const identity = new SocketIdentity(ws, identities, Boolean(auth.noAuth), () => {
            clearTimeout(handshakeTimer);
            releasePreAuth?.();
        });
        const handshakeTimer = setTimeout(() => {
            if (!identity.authenticated) ws.close(4401, "Authentication timed out");
        }, HANDSHAKE_TIMEOUT_MS);
        handshakeTimer.unref?.();
        socketPanels.set(ws, identity);
        const tunnels = socketTunnels(ws, identity, options);

        const sendEvent: RpcContext["sendEvent"] = (event, payload) => {
            if (!sendBounded(ws, JSON.stringify({ type: "event", event, payload }))) {
                ws.close(4429, "Slow event consumer");
            }
        };

        const broadcastEvent: RpcContext["broadcastEvent"] = (event, payload) => events.deliver(event, payload, identity.panelId);
        // this computer's own host credential (local/crane.json): never a
        // panel, a relay, or a paired computer's token
        const isOwner = () => {
            const hostToken = options.staticToken;
            return !!hostToken && !!identity.token && identity.panelId === null &&
                identity.relayTo === null && secretsMatch(identity.token, hostToken);
        };

        ws.on("close", () => {
            clearTimeout(handshakeTimer);
            releasePreAuth?.();
            identity.unindex();
            events.forget(ws);
            monitor.unsubscribe(ws);
            engine.detachStreams(ws);
            if (blocksRegistry.handleSocketClose(ws)) {
                broadcastEvent("blocks:registry-updated", { type: "socket:closed" });
            }
            // the socket is dead: close upstreams, notify no one
            tunnels.closeAll();
        });

        ws.on("message", async (raw: any) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (identity.authenticated && identity.token && !auth.verifyToken(identity.token)) {
                ws.close(4401, "Credential revoked");
                return;
            }
            if (inFlight >= MAX_IN_FLIGHT_PER_SOCKET || inFlightTotal >= 4096) {
                ws.close(4429, "Too many concurrent requests");
                return;
            }
            inFlight++;
            inFlightTotal++;
            // kept for the catch below so failures always answer
            let failedId: unknown = null;
            let failedAction: string | null = null;
            // records this request's answer for the monitor, once; null
            // while nobody watches, so an unwatched daemon builds nothing
            let tapAnswer: ((error?: string, code?: string) => void) | null = null;
            try {
                const maybe = JSON.parse(raw.toString("utf8"));

                // replies from background services — only from authenticated
                // sockets, so an unauthenticated LAN peer cannot inject
                // results into another socket's pending calls
                if (maybe && typeof maybe === "object" && maybe.type === "action_reply") {
                    if (!identity.authenticated) {
                        logger.debug("[ws] dropping pre-auth action_reply frame");
                        return;
                    }
                    blocksRegistry.handleReply(maybe.callId, maybe.result, maybe.error, ws);
                    return;
                }

                if (tunnels.handleFrame(maybe)) return;

                const msg = maybe;
                failedId = (msg as any)?.id ?? null;
                const { id, action, params } = msg;
                failedAction = typeof action === "string" ? action : null;
                if (monitor.active) {
                    const at = Date.now();
                    const started = performance.now();
                    tapAnswer = (error, code) => {
                        tapAnswer = null;
                        monitor.rpc({ panel: identity.panelId, method: action, params, at, started, error: error ?? undefined, code });
                    };
                }

                const send = (rid: unknown, result: any, error?: string, code?: string) => {
                    if (rid === id) tapAnswer?.(error, code);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: "response", id: rid, result, error, ...(code ? { code } : {}) }));
                    }
                };
                const reply = (result: any, error?: string, code?: string) => send(id, result, error, code);

                const rpcCtx: RpcContext = {
                    wss,
                    ws,
                    engine,
                    auth,
                    roster: options.roster,
                    shared: options.shared,
                    callerPanelId: () => identity.panelId,
                    isOwner,
                    sendEvent,
                    broadcastEvent,
                    reply: send,
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

                if (await handleAuth(action, params, { ws, auth, identity, remoteAddress: req?.socket?.remoteAddress, reply, revokeSockets })) return;

                if (action === "events:subscribe") {
                    reply({ success: true, count: events.subscribe(ws, readParams(action, params).events) });
                    return;
                }

                // the traffic monitor sees every panel's calls, so it is for
                // this computer's own host credential (local/crane.json)
                // only: never a panel, a relay, or a paired computer's token
                if (action === MONITOR_SUBSCRIBE) {
                    if (!isOwner()) {
                        reply(null, `${MONITOR_SUBSCRIBE} needs this computer's own host credential (local/crane.json)`, ErrorCode.FORBIDDEN);
                        return;
                    }
                    const panelId = params?.panelId === undefined ? null : readValue(panelIdShape(), params.panelId, "panelId");
                    reply({ success: true, protocol: MONITOR_PROTOCOL });
                    monitor.subscribe(ws, panelId);
                    return;
                }
                if (action === MONITOR_UNSUBSCRIBE) {
                    monitor.unsubscribe(ws);
                    reply({ success: true });
                    return;
                }

                if (await dispatch(action, id, params, rpcCtx)) return;
                reply(null, `Unknown action: ${action}`, ErrorCode.NOT_FOUND);
            } catch (err: any) {
                // always answer with a sanitized message, never a stack.
                // malformed calls (PaperAPI's protocol/rpc.ts shapes) get a typed
                // INVALID_PARAMS; everything else is INTERNAL.
                try {
                    const error = `Request failed: ${err?.message || "internal error"}`;
                    const code = rpcErrorCode(err);
                    tapAnswer?.(error, code);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                            JSON.stringify({
                                type: "response",
                                id: failedId,
                                result: null,
                                error,
                                code,
                            }),
                        );
                    }
                } catch (replyErr) {
                    logger.debug("[Paperboard Server:RPC] error reply failed:", replyErr);
                }
                logger.error(`[Paperboard Server:RPC] ${failedAction ?? "a frame"} failed:`, err?.message || err);
                if (err instanceof SyntaxError) ws.close(1007, "Malformed RPC frame");
            } finally {
                inFlight--;
                inFlightTotal--;
            }
        });
    });
}
