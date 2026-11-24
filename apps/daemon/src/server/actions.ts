import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { logger } from "../core/logger";
import { RpcError } from "../rpc/errors";
import { ErrorCode } from "../core/protocol";

export interface ActionProject {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
    /** a path in the panel's folder, or a base64 data:image URL */
    image?: string;
}

interface RegisteredProject extends ActionProject {
    ws: WebSocket;
}

/** The project a block id names: "server1/command.send" is server1's, "command.send" is the panel's own. */
export function projectOfAction(action: string): string | undefined {
    const slash = action.indexOf("/");
    return slash === -1 ? undefined : action.slice(0, slash);
}

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
    // undefined when the caller opted out of a deadline (timeoutMs null)
    timer: ReturnType<typeof setTimeout> | undefined;
    callerWs: WebSocket;
    // the socket the block is registered on: the only socket whose
    // action_reply may settle this call
    targetWs: WebSocket;
    // an operation the target requested while answering this call is running
    // and will stop the target (carryCall): the call outlives the target's
    // socket until that operation answers it
    carried?: boolean;
}

/** how a carried call is answered when its operation ends */
export interface CarriedOutcome {
    result?: unknown;
    error?: string;
}

// result of a namespace write; ok:false with code "CONFLICT" means the name
// is already owned by a different socket; `block` names the entry it is
// refused for, when it is an entry
export type RegistryResult =
    | { ok: true }
    | { ok: false; code: "CONFLICT"; owner: WebSocket; block?: string };

/** A refused project definition or project block: answered INVALID_PARAMS. */
export class ProjectError extends Error {
    readonly code = ErrorCode.INVALID_PARAMS;
    name = "ProjectError";
}

export class BlocksRegistry {
    private actions = new Map<string, RegisteredAction>();
    private socketActions = new Map<WebSocket, Set<string>>();
    private pendingCalls = new Map<string, PendingActionCall>();
    // projects keyed "panelId:projectId", owned by the socket that defined them
    private projects = new Map<string, RegisteredProject>();
    private socketProjects = new Map<WebSocket, Set<string>>();

    private actionKey(panelId: string, action: string): string {
        return `${panelId}:${action}`;
    }

    /**
     * Registers one pass of a panel's blocks: all of them, or none when one
     * is owned by another socket or names a project this socket didn't define.
     */
    public register(
        panelId: string,
        entries: { entry: string; schema?: any }[],
        ws: WebSocket,
    ): RegistryResult {
        for (const { entry } of entries) {
            const existing = this.actions.get(this.actionKey(panelId, entry));
            if (existing && existing.ws !== ws) {
                logger.warn(
                    `[Blocks] Refused to register "${entry}" for panel "${panelId}": already registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws, block: entry };
            }
            this.assertProjectOwned(panelId, entry, ws);
        }

        let set = this.socketActions.get(ws);
        if (!set) {
            set = new Set();
            this.socketActions.set(ws, set);
        }
        for (const { entry, schema } of entries) {
            const key = this.actionKey(panelId, entry);
            this.actions.set(key, { panelId, action: entry, schema, ws });
            set.add(key);
        }

        logger.info(`[Blocks] Registered ${entries.length} ${entries.length === 1 ? "block" : "blocks"} for panel "${panelId}"`);
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
                    `[Blocks] Refused to unregister "${actionName}" for panel "${panelId}": registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws };
            }
            this.actions.delete(key);
            if (ws) this.socketActions.get(ws)?.delete(key);
            return { ok: true };
        }

        for (const [key, entry] of this.actions.entries()) {
            if (entry.panelId === panelId && (!ws || entry.ws === ws)) {
                this.actions.delete(key);
                if (ws) this.socketActions.get(ws)?.delete(key);
            }
        }
        return { ok: true };
    }

    // a project block may only be registered into a project this socket
    // defined for this panel: removing the project then removes it too
    private assertProjectOwned(panelId: string, actionName: string, ws: WebSocket): void {
        const project = projectOfAction(actionName);
        if (project === undefined) return;
        const owner = this.projects.get(this.actionKey(panelId, project));
        if (!owner || owner.ws !== ws) {
            throw new ProjectError(
                `Project "${project}" is not defined for panel "${panelId}" on this connection; define it before registering "${actionName}"`,
            );
        }
    }

    /** Defines a project, or renames one this socket already owns. */
    public defineProject(panelId: string, project: { id: string; name: string; icon?: string; image?: string }, ws: WebSocket): RegistryResult {
        const name = project.name.trim();
        if (!name) throw new ProjectError(`Project "${project.id}" needs a name`);
        const key = this.actionKey(panelId, project.id);
        const existing = this.projects.get(key);
        if (existing && existing.ws !== ws) {
            logger.warn(`[Blocks] Refused to define project "${project.id}" for panel "${panelId}": defined by another socket`);
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }
        this.projects.set(key, {
            panelId,
            id: project.id,
            name,
            ...(project.icon ? { icon: project.icon } : {}),
            ...(project.image ? { image: project.image } : {}),
            ws,
        });
        let set = this.socketProjects.get(ws);
        if (!set) {
            set = new Set();
            this.socketProjects.set(ws, set);
        }
        set.add(key);
        logger.info(`[Blocks] ${existing ? "Updated" : "Defined"} project "${project.id}" for panel "${panelId}"`);
        return { ok: true };
    }

    /** Removes a project and every block registered into it. */
    public removeProject(panelId: string, projectId: string, ws: WebSocket): RegistryResult {
        const key = this.actionKey(panelId, projectId);
        const existing = this.projects.get(key);
        if (!existing) return { ok: true };
        if (existing.ws !== ws) {
            logger.warn(`[Blocks] Refused to remove project "${projectId}" for panel "${panelId}": defined by another socket`);
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }
        this.dropProject(key, existing);
        logger.info(`[Blocks] Removed project "${projectId}" for panel "${panelId}"`);
        return { ok: true };
    }

    private dropProject(key: string, project: RegisteredProject): void {
        this.projects.delete(key);
        this.socketProjects.get(project.ws)?.delete(key);
        const prefix = `${project.panelId}:${project.id}/`;
        for (const [actionKey, entry] of this.actions) {
            if (!actionKey.startsWith(prefix)) continue;
            this.actions.delete(actionKey);
            this.socketActions.get(entry.ws)?.delete(actionKey);
        }
    }

    public listProjects(filterPanelId?: string): ActionProject[] {
        const list: ActionProject[] = [];
        for (const p of this.projects.values()) {
            if (filterPanelId && p.panelId !== filterPanelId) continue;
            list.push({
                panelId: p.panelId,
                id: p.id,
                name: p.name,
                ...(p.icon ? { icon: p.icon } : {}),
                ...(p.image ? { image: p.image } : {}),
            });
        }
        return list;
    }

    public handleSocketClose(ws: WebSocket): boolean {
        let changed = false;
        const keys = this.socketActions.get(ws);
        if (keys && keys.size > 0) {
            for (const key of keys) this.actions.delete(key);
            this.socketActions.delete(ws);
            changed = true;
        }
        const projectKeys = this.socketProjects.get(ws);
        if (projectKeys && projectKeys.size > 0) {
            for (const key of projectKeys) this.projects.delete(key);
            changed = true;
        }
        this.socketProjects.delete(ws);

        for (const [callId, pending] of this.pendingCalls.entries()) {
            if (pending.callerWs === ws) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(callId);
                pending.reject(
                    new Error(`Block call "${pending.panelId}:${pending.action}" aborted: caller socket closed`),
                );
            } else if (pending.carried && pending.targetWs === ws) {
                // the operation that stopped this socket answers the call (carryCall)
            } else {
                const key = this.actionKey(pending.panelId, pending.action);
                const reg = this.actions.get(key);
                if (!reg || reg.ws === ws) {
                    clearTimeout(pending.timer);
                    this.pendingCalls.delete(callId);
                    pending.reject(
                        new Error(`Block service for "${pending.panelId}:${pending.action}" disconnected`),
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
        timeoutMs: number | null = 30_000,
        callerPanelId: string | null = null,
    ): Promise<unknown> {
        const key = this.actionKey(panelId, action);
        const registered = this.actions.get(key);
        if (!registered || registered.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Block "${action}" on panel "${panelId}" is not registered or unavailable`);
        }
        if (registered.schema?.internal === true && callerPanelId !== null && callerPanelId !== panelId) {
            logger.warn(`[Blocks] "${callerPanelId}" refused internal block "${panelId}:${action}"`);
            throw new RpcError(ErrorCode.FORBIDDEN, `Block "${action}" is internal to panel "${panelId}"`);
        }

        const callId = `call_${randomUUID()}`;

        return new Promise((resolve, reject) => {
            const timer =
                timeoutMs === null
                    ? undefined
                    : setTimeout(() => {
                          this.pendingCalls.delete(callId);
                          reject(new Error(`Block call "${panelId}:${action}" timed out after ${timeoutMs}ms`));
                      }, timeoutMs);
            timer?.unref?.();

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

            try {
                registered.ws.send(
                    JSON.stringify({
                        type: "action_call",
                        registry: "blocks",
                        callId,
                        panelId,
                        action,
                        args,
                        caller: { panelId: callerPanelId },
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
        error: string | undefined,
        fromWs: WebSocket,
    ): boolean {
        const pending = this.pendingCalls.get(callId);
        if (!pending) return false;
        if (pending.targetWs !== fromWs) {
            logger.warn(`[Blocks] dropped reply for "${pending.panelId}:${pending.action}" from a socket that was not called`);
            return false;
        }

        this.settle(pending, { result, error });
        return true;
    }

    private settle(pending: PendingActionCall, { result, error }: CarriedOutcome): void {
        this.pendingCalls.delete(pending.callId);
        clearTimeout(pending.timer);
        if (error) {
            pending.reject(new Error(error));
        } else {
            pending.resolve(result);
        }
    }

    /**
     * For a service asking for something that stops the service itself (a
     * backup pauses its panel's service): the service cannot answer the block
     * call it is in the middle of, since it will be gone. The call stays
     * pending past the service's socket, and the returned function answers it
     * with the operation's outcome when the service did go away.
     */
    public carryCall(callId: string, fromWs: WebSocket): ((outcome: CarriedOutcome) => void) | null {
        const pending = this.pendingCalls.get(callId);
        if (!pending) return null;
        if (pending.targetWs !== fromWs) {
            throw new RpcError(ErrorCode.FORBIDDEN, "That block call was not sent to this connection");
        }
        pending.carried = true;
        return (outcome) => {
            const current = this.pendingCalls.get(callId);
            if (current !== pending || !pending.carried) return;
            pending.carried = false;
            if (pending.targetWs.readyState !== WebSocket.OPEN) this.settle(pending, outcome);
        };
    }

    public list(
        filterPanelId?: string,
    ): { panelId: string; action: string; project?: string; schema?: any }[] {
        const list: { panelId: string; action: string; project?: string; schema?: any }[] = [];
        for (const entry of this.actions.values()) {
            if (!filterPanelId || entry.panelId === filterPanelId) {
                const project = projectOfAction(entry.action);
                list.push({
                    panelId: entry.panelId,
                    action: entry.action,
                    ...(project !== undefined ? { project } : {}),
                    schema: entry.schema,
                });
            }
        }
        return list;
    }
}

/** The Blocks registry (PaperAPI blocksApi). */
export const blocksRegistry = new BlocksRegistry();
