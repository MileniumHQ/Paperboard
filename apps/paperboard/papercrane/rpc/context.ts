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
    sendEvent: (event: string, payload: any) => void;
    broadcastEvent: (event: string, payload: any) => void;
    reply: (id: unknown, result: any, error?: string) => void;
}

export type RpcHandler = (
    id: unknown,
    params: any,
    ctx: RpcContext,
) => Promise<void> | void;
