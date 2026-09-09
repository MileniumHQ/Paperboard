import { WebSocket } from "ws";
import { logger } from "./logger";

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

export class ActionsRegistry {
    private actions = new Map<string, RegisteredAction>();
    private triggers = new Map<string, RegisteredTrigger>();
    private socketActions = new Map<WebSocket, Set<string>>();
    private socketTriggers = new Map<WebSocket, Set<string>>();
    private pendingCalls = new Map<string, PendingActionCall>();
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
    ): void {
        const key = this.actionKey(panelId, actionName);
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
    }

    public registerMultiple(
        panelId: string,
        actionNames: string[],
        ws: WebSocket,
    ): void {
        for (const actionName of actionNames) {
            this.register(panelId, actionName, ws);
        }
    }

    public registerTrigger(
        panelId: string,
        triggerName: string,
        ws: WebSocket,
        schema?: any,
    ): void {
        const key = this.triggerKey(panelId, triggerName);
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
    }

    public unregister(
        panelId: string,
        actionName?: string,
        ws?: WebSocket,
    ): void {
        if (actionName) {
            const key = this.actionKey(panelId, actionName);
            this.actions.delete(key);
            if (ws) {
                this.socketActions.get(ws)?.delete(key);
            }
        } else {
            for (const [key, entry] of this.actions.entries()) {
                if (entry.panelId === panelId) {
                    this.actions.delete(key);
                    if (ws) {
                        this.socketActions.get(ws)?.delete(key);
                    }
                }
            }
        }
    }

    public unregisterTrigger(
        panelId: string,
        triggerName?: string,
        ws?: WebSocket,
    ): void {
        if (triggerName) {
            const key = this.triggerKey(panelId, triggerName);
            this.triggers.delete(key);
            if (ws) {
                this.socketTriggers.get(ws)?.delete(key);
            }
        } else {
            for (const [key, entry] of this.triggers.entries()) {
                if (entry.panelId === panelId) {
                    this.triggers.delete(key);
                    if (ws) {
                        this.socketTriggers.get(ws)?.delete(key);
                    }
                }
            }
        }
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

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingCalls.delete(callId);
                reject(
                    new Error(
                        `Action call "${panelId}:${action}" timed out after ${timeoutMs}ms`,
                    ),
                );
            }, timeoutMs);

            this.pendingCalls.set(callId, {
                callId,
                panelId,
                action,
                resolve,
                reject,
                timer,
                callerWs,
            });

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
