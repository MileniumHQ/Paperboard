import type { WebSocket, WebSocketServer } from "ws";
import type { PaperCraneEngine } from "../engine";
import type { PaperCraneAuth } from "../auth";

// per-connection context for all RPC handlers
export interface RpcContext {
    wss: WebSocketServer;
    ws: WebSocket;
    engine: PaperCraneEngine;
    auth: PaperCraneAuth;
    isAuthenticated: () => boolean;
    setAuthenticated: (v: boolean) => void;
    // panel scope granted at token issuance (auth panelId claim). Null =
    // full-authority caller (master/host token or noAuth dev mode).
    // Handlers derive identity from this, never from a caller parameter.
    callerPanelId: () => string | null;
    sendEvent: (event: string, payload: any) => void;
    broadcastEvent: (event: string, payload: any) => void;
    reply: (id: unknown, result: any, error?: string, code?: string) => void;
}

export type RpcHandler = (
    id: unknown,
    params: any,
    ctx: RpcContext,
) => Promise<void> | void;
