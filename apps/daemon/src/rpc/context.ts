import type { WebSocket, WebSocketServer } from "ws";
import type { PaperCraneEngine } from "../engine";
import type { PaperCraneAuth } from "../auth";
import type { EventPayload } from "@mileniumhq/paperapi/protocol";

// per-connection context for all RPC handlers
export interface RpcContext {
    wss: WebSocketServer;
    ws: WebSocket;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    // panel scope granted at token issuance (auth panelId claim). Null =
    // full-authority caller (master/host token or noAuth dev mode).
    // Handlers derive identity from this, never from a caller parameter.
    callerPanelId: () => string | null;
    // an event the contract declares carries its payload (PaperAPI's protocol/events.ts)
    sendEvent: <E extends string>(event: E, payload: EventPayload<E>) => void;
    broadcastEvent: <E extends string>(event: E, payload: EventPayload<E>) => void;
    reply: (id: unknown, result: unknown, error?: string, code?: string) => void;
}
