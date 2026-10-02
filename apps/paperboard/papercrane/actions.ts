import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { RpcError } from "./rpc/errors";
import { ErrorCode } from "./protocol";

// outstanding action-call caps, mirroring the client surface
// (PaperAPI CraneTransport.MAX_PENDING_CALLS): a caller runaway is refused
// with a typed error naming the cap, never queued forever.
export const MAX_PENDING_CALLS_PER_SOCKET = 1000;
export const MAX_PENDING_CALLS = 4000;

export type PendingCallRefusal =
    | { cap: "global"; count: number }
    | { cap: "per-socket"; count: number };

export interface RegisteredAction {
    panelId: string;
    action: string;
    schema?: any;
    ws: WebSocket;
}

export interface PendingActionCall {
    callId: string;
    panelId: string;
    action: string;
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    callerWs: WebSocket;
    // the socket the action is registered on: the only socket whose
    // action_reply may settle this call
    targetWs: WebSocket;
}

// result of a namespace write; ok:false with code "CONFLICT" means the name
// is already owned by a different socket
export type RegistryResult =
    | { ok: true }
    | { ok: false; code: "CONFLICT"; owner: WebSocket };

export class ActionsRegistry {
    // ONE key space for every registrable thing: callable actions and event
    // actions share the `panelId:action` namespace, so a callable action and
    // an event can never shadow each other's identity. Mirrored per-kind
    // maps were how register/unregister and socket teardown logic drifted
    // apart.
    private actions = new Map<string, RegisteredAction>();
    private socketActions = new Map<WebSocket, Set<string>>();
    private pendingCalls = new Map<string, PendingActionCall>();
    // per-caller outstanding call ids (teardown: handleSocketClose drops
    // the set together with pendingCalls entries)
    private socketPendingCalls = new Map<WebSocket, Set<string>>();

    private actionKey(panelId: string, action: string): string {
        return `${panelId}:${action}`;
    }

    public register(
        panelId: string,
        actionName: string,
        ws: WebSocket,
        schema?: any,
    ): RegistryResult {
        const key = this.actionKey(panelId, actionName);
        const existing = this.actions.get(key);
        if (existing && existing.ws !== ws) {
            logger.warn(
                `[Actions] Refused to register "${actionName}" for panel "${panelId}": already registered by another socket`,
            );
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }

        this.actions.set(key, { panelId, action: actionName, schema, ws });

        let set = this.socketActions.get(ws);
        if (!set) {
            set = new Set();
            this.socketActions.set(ws, set);
        }
        set.add(key);

        logger.info(
            `[Actions] Registered action "${actionName}" for panel "${panelId}"`,
        );
        return { ok: true };
    }

    public registerMultiple(
        panelId: string,
        actionNames: string[],
        ws: WebSocket,
    ): RegistryResult {
        for (const actionName of actionNames) {
            const existing = this.actions.get(this.actionKey(panelId, actionName));
            if (existing && existing.ws !== ws) {
                logger.warn(
                    `[Actions] Refused batch registration for panel "${panelId}": action "${actionName}" already registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws };
            }
        }
        for (const actionName of actionNames) {
            this.register(panelId, actionName, ws);
        }
        return { ok: true };
    }

    public unregister(
        panelId: string,
        actionName?: string,
        ws?: WebSocket,
    ): RegistryResult {
        if (actionName) {
            const key = this.actionKey(panelId, actionName);
            const existing = this.actions.get(key);
            if (existing && ws && existing.ws !== ws) {
                logger.warn(
                    `[Actions] Refused to unregister "${actionName}" for panel "${panelId}": registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws };
            }
            this.actions.delete(key);
            if (ws) {
                this.socketActions.get(ws)?.delete(key);
            }
            return { ok: true };
        }

        for (const [key, entry] of this.actions.entries()) {
            if (entry.panelId === panelId && (!ws || entry.ws === ws)) {
                this.actions.delete(key);
                if (ws) {
                    this.socketActions.get(ws)?.delete(key);
                }
            }
        }
        return { ok: true };
    }

    public handleSocketClose(ws: WebSocket): boolean {
        let changed = false;
        const keys = this.socketActions.get(ws);
        if (keys && keys.size > 0) {
            for (const key of keys) {
                this.actions.delete(key);
            }
            this.socketActions.delete(ws);
            changed = true;
        }

        // drop pending calls tied to this socket
        for (const [callId, pending] of this.pendingCalls.entries()) {
            if (pending.callerWs === ws) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(callId);
                // the caller is gone: nobody will return, but the promise
                // must still settle — a stuck call is a leaked slot
                pending.reject(
                    new Error(
                        `Action call "${pending.panelId}:${pending.action}" aborted: caller socket closed`,
                    ),
                );
            } else {
                const key = this.actionKey(pending.panelId, pending.action);
                const reg = this.actions.get(key);
                if (!reg || reg.ws === ws) {
                    clearTimeout(pending.timer);
                    this.pendingCalls.delete(callId);
                    pending.reject(
                        new Error(
                            `Action service for "${pending.panelId}:${pending.action}" disconnected`,
                        ),
                    );
                }
            }
        }

        // teardown path for the per-socket outstanding-call set
        this.socketPendingCalls.delete(ws);

        return changed;
    }

    // callerPanelId is the caller socket's token claim (null = host). It
    // travels in the action_call frame so the handling panel knows who is
    // calling, and gates `internal` actions: those answer only their own
    // panel (or the host), never another panel.
    public async call(
        panelId: string,
        action: string,
        args: unknown[] = [],
        callerWs: WebSocket,
        timeoutMs: number = 30_000,
        callerPanelId: string | null = null,
    ): Promise<unknown> {
        const key = this.actionKey(panelId, action);
        const registered = this.actions.get(key);
        if (!registered || registered.ws.readyState !== WebSocket.OPEN) {
            throw new Error(
                `Action "${action}" on panel "${panelId}" is not registered or unavailable`,
            );
        }
        if (registered.schema?.internal === true && callerPanelId !== null && callerPanelId !== panelId) {
            logger.warn(`[Actions] "${callerPanelId}" refused internal action "${panelId}:${action}"`);
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `Action "${action}" is internal to panel "${panelId}"`,
            );
        }

        // unguessable: a reply must name a call it was actually sent
        const callId = `call_${randomUUID()}`;

        // bounded at both scopes: a caller runaway is refused with a typed
        // error naming the cap, never queued into an unbounded map
        const globalCount = this.pendingCalls.size;
        if (globalCount >= MAX_PENDING_CALLS) {
            logger.warn(
                `[Actions] Call refused: ${globalCount} outstanding calls (global cap ${MAX_PENDING_CALLS})`,
            );
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `Too many outstanding action calls: ${globalCount} (global cap ${MAX_PENDING_CALLS})`,
            );
        }
        const socketSet = this.socketPendingCalls.get(callerWs);
        const socketCount = socketSet?.size ?? 0;
        if (socketCount >= MAX_PENDING_CALLS_PER_SOCKET) {
            logger.warn(
                `[Actions] Call refused: caller socket has ${socketCount} outstanding calls (per-socket cap ${MAX_PENDING_CALLS_PER_SOCKET})`,
            );
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `Too many outstanding action calls on this connection: ${socketCount} (cap ${MAX_PENDING_CALLS_PER_SOCKET})`,
            );
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const held = this.socketPendingCalls.get(callerWs);
                held?.delete(callId);
                if (held && held.size === 0) this.socketPendingCalls.delete(callerWs);
                this.pendingCalls.delete(callId);
                reject(
                    new Error(
                        `Action call "${panelId}:${action}" timed out after ${timeoutMs}ms`,
                    ),
                );
            }, timeoutMs);
            timer.unref?.();

            this.pendingCalls.set(callId, {
                callId,
                panelId,
                action,
                resolve,
                reject,
                timer,
                callerWs,
                targetWs: registered.ws,
            });
            if (!socketSet) {
                this.socketPendingCalls.set(callerWs, new Set([callId]));
            } else {
                socketSet.add(callId);
            }

            try {
                registered.ws.send(
                    JSON.stringify({
                        type: "action_call",
                        callId,
                        panelId,
                        action,
                        args,
                        caller: { panelId: callerPanelId },
                    }),
                );
            } catch (err: any) {
                const held = this.socketPendingCalls.get(callerWs);
                held?.delete(callId);
                if (held && held.size === 0) this.socketPendingCalls.delete(callerWs);
                clearTimeout(timer);
                this.pendingCalls.delete(callId);
                reject(err);
            }
        });
    }

    // fromWs must be the socket the call was dispatched to: any other
    // authenticated socket answering is refused, never allowed to settle
    // someone else's call
    public handleReply(
        callId: string,
        result: unknown,
        error: string | undefined,
        fromWs: WebSocket,
    ): boolean {
        const pending = this.pendingCalls.get(callId);
        if (!pending) return false;
        if (pending.targetWs !== fromWs) {
            logger.warn(`[Actions] dropped action_reply for "${pending.panelId}:${pending.action}" from a socket that was not called`);
            return false;
        }

        this.pendingCalls.delete(callId);
        clearTimeout(pending.timer);

        const held = this.socketPendingCalls.get(pending.callerWs);
        held?.delete(callId);
        if (held && held.size === 0) {
            this.socketPendingCalls.delete(pending.callerWs);
        }

        if (error) {
            pending.reject(new Error(error));
        } else {
            pending.resolve(result);
        }
        return true;
    }

    public list(
        filterPanelId?: string,
    ): { panelId: string; action: string; schema?: any }[] {
        const list: { panelId: string; action: string; schema?: any }[] = [];
        for (const entry of this.actions.values()) {
            if (!filterPanelId || entry.panelId === filterPanelId) {
                list.push({
                    panelId: entry.panelId,
                    action: entry.action,
                    schema: entry.schema,
                });
            }
        }
        return list;
    }
}

export const actionsRegistry = new ActionsRegistry();
