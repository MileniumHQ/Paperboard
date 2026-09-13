import { WebSocket } from "ws";
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

export interface RegisteredTrigger {
    panelId: string;
    trigger: string;
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
}

// result of a namespace write; ok:false with code "CONFLICT" means the name
// is already owned by a different socket
export type RegistryResult =
    | { ok: true }
    | { ok: false; code: "CONFLICT"; owner: WebSocket };

export class ActionsRegistry {
    private actions = new Map<string, RegisteredAction>();
    private triggers = new Map<string, RegisteredTrigger>();
    private socketActions = new Map<WebSocket, Set<string>>();
    private socketTriggers = new Map<WebSocket, Set<string>>();
    private pendingCalls = new Map<string, PendingActionCall>();
    // per-caller outstanding call ids (teardown: handleSocketClose drops
    // the set together with pendingCalls entries)
    private socketPendingCalls = new Map<WebSocket, Set<string>>();
    private callIdCounter = 1;

    private actionKey(panelId: string, action: string): string {
        return `${panelId}:${action}`;
    }

    private triggerKey(panelId: string, trigger: string): string {
        return `${panelId}:${trigger}`;
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

    public registerTrigger(
        panelId: string,
        triggerName: string,
        ws: WebSocket,
        schema?: any,
    ): RegistryResult {
        const key = this.triggerKey(panelId, triggerName);
        const existing = this.triggers.get(key);
        if (existing && existing.ws !== ws) {
            logger.warn(
                `[Triggers] Refused to register trigger "${triggerName}" for panel "${panelId}": already registered by another socket`,
            );
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }

        this.triggers.set(key, { panelId, trigger: triggerName, schema, ws });

        let set = this.socketTriggers.get(ws);
        if (!set) {
            set = new Set();
            this.socketTriggers.set(ws, set);
        }
        set.add(key);

        logger.info(
            `[Triggers] Registered trigger "${triggerName}" for panel "${panelId}"`,
        );
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

    public unregisterTrigger(
        panelId: string,
        triggerName?: string,
        ws?: WebSocket,
    ): RegistryResult {
        if (triggerName) {
            const key = this.triggerKey(panelId, triggerName);
            const existing = this.triggers.get(key);
            if (existing && ws && existing.ws !== ws) {
                logger.warn(
                    `[Triggers] Refused to unregister trigger "${triggerName}" for panel "${panelId}": registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws };
            }
            this.triggers.delete(key);
            if (ws) {
                this.socketTriggers.get(ws)?.delete(key);
            }
            return { ok: true };
        }

        for (const [key, entry] of this.triggers.entries()) {
            if (entry.panelId === panelId && (!ws || entry.ws === ws)) {
                this.triggers.delete(key);
                if (ws) {
                    this.socketTriggers.get(ws)?.delete(key);
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

        const trigKeys = this.socketTriggers.get(ws);
        if (trigKeys && trigKeys.size > 0) {
            for (const key of trigKeys) {
                this.triggers.delete(key);
            }
            this.socketTriggers.delete(ws);
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

    public async call(
        panelId: string,
        action: string,
        args: unknown[] = [],
        callerWs: WebSocket,
        timeoutMs: number = 30_000,
    ): Promise<unknown> {
        const key = this.actionKey(panelId, action);
        const registered = this.actions.get(key);
        if (!registered || registered.ws.readyState !== WebSocket.OPEN) {
            throw new Error(
                `Action "${action}" on panel "${panelId}" is not registered or unavailable`,
            );
        }

        const callId = `call_${Date.now()}_${this.callIdCounter++}`;

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

    public handleReply(
        callId: string,
        result: unknown,
        error?: string,
    ): boolean {
        const pending = this.pendingCalls.get(callId);
        if (!pending) return false;

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

    public listTriggers(
        filterPanelId?: string,
    ): { panelId: string; trigger: string; schema?: any }[] {
        const list: { panelId: string; trigger: string; schema?: any }[] = [];
        for (const entry of this.triggers.values()) {
            if (!filterPanelId || entry.panelId === filterPanelId) {
                list.push({
                    panelId: entry.panelId,
                    trigger: entry.trigger,
                    schema: entry.schema,
                });
            }
        }
        return list;
    }
}

export const actionsRegistry = new ActionsRegistry();
