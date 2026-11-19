// Frame limits shared by the RPC sockets and the tunnels they carry.
import { WebSocket } from "ws";

export const MAX_WS_PAYLOAD = 20 * 1024 * 1024;
const MAX_WS_BUFFERED_BYTES = 32 * 1024 * 1024;
export const HANDSHAKE_TIMEOUT_MS = 10_000;

// Include the next frame in the budget: a bounded frame must not overshoot
// the socket's cumulative queue limit. Callers own slow-consumer teardown.
export function sendBounded(socket: WebSocket, payload: string): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount + Buffer.byteLength(payload) > MAX_WS_BUFFERED_BYTES) return false;
    socket.send(payload);
    return true;
}
