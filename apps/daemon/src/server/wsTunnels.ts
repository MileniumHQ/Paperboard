// Tunnels from one RPC socket to paired remotes: the upstream handshake
// (auth, then a scope grant for a panel socket), the heartbeat that notices
// a remote gone quiet, and forwarding frames both ways.
import * as path from "path";
import { WebSocket } from "ws";
import { getLocalDir } from "../core/paths";
import { readRemotes } from "../system/remotes";
import { dialPinned, type PinnedDial } from "../security/pinnedDial";
import { logger } from "../core/logger";
import { ErrorCode } from "../core/protocol";
import { readValue, text } from "@mileniumhq/paperapi/protocol";
import { errorMessage } from "@mileniumhq/paperapi/errors";
import { HANDSHAKE_TIMEOUT_MS, MAX_WS_PAYLOAD, sendBounded } from "./wsFrames";
import type { SocketIdentity } from "./wsIdentity";

// per-socket tunnel cap: each tunnel is a live upstream socket, so an
// authenticated socket may not open an unbounded number of them
const MAX_TUNNELS_PER_SOCKET = 32;
const TUNNEL_HEARTBEAT_MS = 15_000;

export interface TunnelOptions {
    /** the paired-computers file; a standalone daemon (papercrane serve, the
     *  systemd service) reads the one in its own data folder */
    remotesFile?: string;
    /** upstream ping interval for remote tunnels (tests shorten it) */
    tunnelHeartbeatMs?: number;
}

interface Tunnel {
    // null while the computer's addresses are still being dialed
    socket: WebSocket | null;
    dial: PinnedDial;
    ready: boolean;
    timer: ReturnType<typeof setTimeout>;
    heartbeat?: ReturnType<typeof setInterval>;
    onPong?: () => void;
}

/** The tunnels of one socket. handleFrame answers tunnel frames; closeAll ends them silently. */
export function socketTunnels(ws: WebSocket, identity: SocketIdentity, options: TunnelOptions) {
    // tunnels to paired remotes, keyed by tunnel id
    const tunnels = new Map<string, Tunnel>();

    // one teardown shape for every tunnel exit: map removal lives here, not
    // scattered across event handlers. Notify-once falls out of the early
    // return — a late upstream close after an error (or after the local
    // socket died) cannot emit a second tunnel-closed.
    const closeTunnel = (tunnelId: string, opts: { reason?: string; notify?: boolean } = {}): void => {
        const tunnel = tunnels.get(tunnelId);
        if (!tunnel) return;
        tunnels.delete(tunnelId);
        clearTimeout(tunnel.timer);
        clearInterval(tunnel.heartbeat);
        tunnel.dial.cancel();
        if (tunnel.onPong) tunnel.socket?.off("pong", tunnel.onPong);
        try {
            tunnel.socket?.terminate();
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

    // the socket is dead or too slow: close upstreams, notify no one
    const closeAll = () => {
        for (const id of [...tunnels.keys()]) closeTunnel(id, { notify: false });
    };

    const forwardTunnel = (destination: WebSocket, payload: string) => {
        if (sendBounded(destination, payload)) return;
        // Do not wait for the slow socket's close handshake: it may not read
        // again. Release every upstream and its heartbeat now.
        closeAll();
        ws.close(4429, "Slow tunnel consumer");
    };

    const open = (maybe: any) => {
        // relaying uses the host's stored remote token — an unauthenticated
        // LAN socket must never be able to open one. background-service
        // sockets authenticate at attach, so the legit path is unaffected.
        if (!identity.authenticated) {
            const refusedId = maybe.tunnelId ?? maybe.id ?? null;
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "tunnel-closed",
                    id: refusedId,
                    result: null,
                    error: "Unauthorized. Authentication required.",
                    reason: "Authentication required before opening a tunnel",
                    code: ErrorCode.AUTH_REQUIRED,
                }));
            }
            return;
        }
        const tunnelId = readValue(text(128), maybe.tunnelId ?? maybe.id, "tunnel id");
        const computerId = readValue(text(128), maybe.computerId, "computerId");
        if (tunnels.has(tunnelId)) throw new Error("Tunnel id is already open");
        // a relay credential reaches exactly the computer that served its
        // panel, by id — never another, never by name
        if (identity.relayTo !== null && computerId !== identity.relayTo) {
            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: "relay-scope" }));
            return;
        }
        // identity first: exact id match wins. A bare name only resolves
        // when it is unambiguous — with two remotes sharing a name,
        // first-match-wins could tunnel to the wrong machine, so refuse
        // instead of guessing.
        const candidates = readRemotes(options.remotesFile ?? path.join(getLocalDir(), "paired_computers.json")).filter(
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
            // its .local name and last address at once; the pinned certificate says which is it
            const hosts = entry.address && entry.address !== entry.host ? [entry.host, entry.address] : [entry.host];
            const dial = dialPinned(hosts, entry.port, entry.cert, { timeoutMs: HANDSHAKE_TIMEOUT_MS, maxPayload: MAX_WS_PAYLOAD });
            const timer = setTimeout(() => closeTunnel(tunnelId, { reason: "Remote authentication timed out" }), HANDSHAKE_TIMEOUT_MS);
            timer.unref?.();
            const tunnel: Tunnel = { socket: null, dial, ready: false, timer };
            let handshake: "auth" | "scope" | "ready" = "auth";
            tunnels.set(tunnelId, tunnel);
            // the upstream, once one of the computer's addresses answered with its certificate
            const attach = (upstream: WebSocket) => {
                // the tunnel was closed while its computer was being dialed
                if (tunnels.get(tunnelId) !== tunnel) {
                    upstream.terminate();
                    return;
                }
                tunnel.socket = upstream;
                const opened = () => {
                    if (tunnel.ready || !tunnels.has(tunnelId) || ws.readyState !== WebSocket.OPEN) return;
                    handshake = "ready";
                    clearTimeout(timer);
                    tunnel.ready = true;
                    // a remote that sleeps or drops off the network leaves the
                    // upstream looking open; one missed pong closes the tunnel
                    // so the panel's transport reopens it instead of hanging
                    let awaitingPong = false;
                    tunnel.onPong = () => { awaitingPong = false; };
                    upstream.on("pong", tunnel.onPong);
                    tunnel.heartbeat = setInterval(() => {
                        if (awaitingPong) {
                            closeTunnel(tunnelId, { reason: "The remote computer stopped responding" });
                            return;
                        }
                        awaitingPong = true;
                        upstream.ping();
                    }, options.tunnelHeartbeatMs ?? TUNNEL_HEARTBEAT_MS);
                    tunnel.heartbeat.unref?.();
                    ws.send(JSON.stringify({ type: "tunnel-open", id: tunnelId }));
                };
                upstream.on("message", (data: any) => {
                    if (!tunnels.has(tunnelId) || upstream.readyState !== WebSocket.OPEN) return;
                    try {
                        const m = JSON.parse(data.toString("utf8"));
                        if (m?.id === "__tunnel-auth") {
                            if (handshake !== "auth") return;
                            if (m.error) {
                                closeTunnel(tunnelId, { reason: "auth-failed" });
                            } else if (identity.panelId) {
                                handshake = "scope";
                                // The paired host GRANTS a narrower socket identity. No
                                // host credential is delivered to the panel or its tunnel.
                                upstream.send(JSON.stringify({ id: "__tunnel-scope", action: "auth:scope", params: { panelId: identity.panelId } }));
                            } else {
                                opened();
                            }
                            return;
                        }
                        if (m?.id === "__tunnel-scope") {
                            if (handshake !== "scope") return;
                            if (m.error) closeTunnel(tunnelId, { reason: `Remote scope grant failed: ${m.error}` });
                            else opened();
                            return;
                        }
                    } catch (err) {
                        // non-JSON frames during handshake, logged for diagnosis
                        logger.debug(`[tunnel ${tunnelId}] non-JSON frame during auth handshake:`, err);
                    }
                    if (tunnel.ready && ws.readyState === WebSocket.OPEN) {
                        forwardTunnel(ws, JSON.stringify({ type: "tunnel", id: tunnelId, payload: data.toString("utf8") }));
                    }
                });
                upstream.on("close", () => {
                    closeTunnel(tunnelId);
                });
                upstream.on("error", (err) => {
                    logger.debug(`[tunnel ${tunnelId}] upstream connection error:`, err);
                    closeTunnel(tunnelId, { reason: "unreachable" });
                });
                upstream.send(JSON.stringify({
                    id: "__tunnel-auth",
                    action: "auth:verify",
                    params: { token: entry.token },
                }));
            };
            dial.result.then(
                ({ socket }) => {
                    try {
                        attach(socket);
                    } catch (err) {
                        closeTunnel(tunnelId, { reason: errorMessage(err) });
                    }
                },
                (err) => {
                    logger.debug(`[tunnel ${tunnelId}] upstream connection error:`, err);
                    closeTunnel(tunnelId, { reason: "unreachable" });
                },
            );
        } catch (err: any) {
            ws.send(JSON.stringify({ type: "tunnel-closed", id: tunnelId, reason: err?.message || "error" }));
        }
    };

    // true when the frame was a tunnel frame, which bypasses the RPC pipeline
    const handleFrame = (maybe: any): boolean => {
        if (!maybe || typeof maybe !== "object") return false;
        // tunneled frames bypass the local pipeline
        if (maybe.type === "tunnel") {
            const tunnel = tunnels.get(maybe.id);
            if (identity.authenticated && tunnel?.ready && tunnel.socket?.readyState === WebSocket.OPEN) {
                forwardTunnel(tunnel.socket, typeof maybe.payload === "string" ? maybe.payload : JSON.stringify(maybe.payload));
            }
            return true;
        }
        if (maybe.type === "remote:open") {
            open(maybe);
            return true;
        }
        if (maybe.type === "remote:close") {
            // client-initiated: tear down silently, no echo frame
            closeTunnel(maybe.id, { notify: false });
            return true;
        }
        return false;
    };

    return { handleFrame, closeAll };
}
