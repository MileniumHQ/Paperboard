import { WebSocket } from "ws";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { RpcError } from "./rpc/errors";
import { ErrorCode } from "./protocol";
import { LimitError } from "./storage";

// outstanding action-call caps, mirroring the client surface
// (PaperAPI CraneTransport.MAX_PENDING_CALLS): a caller runaway is refused
// with a typed error naming the cap, never queued forever.
export const MAX_PENDING_CALLS_PER_SOCKET = 1000;
export const MAX_PENDING_CALLS = 4000;

// registered-action caps: every entry lives for its socket's lifetime and
// actions:list returns them all, so both the count (per socket and in
// total, sized for a thousand panels) and each schema are bounded
export const MAX_ACTIONS_PER_SOCKET = 1024;
export const MAX_ACTIONS = 32_768;
export const MAX_ACTION_SCHEMA_BYTES = 64 * 1024;

// projects: a panel's named sets of actions (one per game server, per bot).
// A project action is registered as "project/action", so it is its own
// action everywhere (calls, events, flows) and never a parameter.
export const MAX_PROJECTS_PER_SOCKET = 256;
export const MAX_PROJECTS = 8192;
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_PROJECT_NAME = 128;

export interface ActionProject {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
    /** a path in the panel's folder, or a base64 data:image URL */
    image?: string;
}

/** The longest project picture: a data URL of a 256 KB server icon fits. */
export const MAX_PROJECT_IMAGE = 512 * 1024;
const PROJECT_IMAGE_DATA = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// a file in the panel's folder: no scheme, no climbing out of it
const PROJECT_IMAGE_PATH = /^\/?[A-Za-z0-9._\/-]+\.(png|webp|jpe?g|gif|svg)$/i;
const isProjectImage = (image: string) =>
    PROJECT_IMAGE_DATA.test(image) || (PROJECT_IMAGE_PATH.test(image) && !image.split("/").includes(".."));

interface RegisteredProject extends ActionProject {
    ws: WebSocket;
}

/** The project an action id names: "server1/send" is server1's, "send" is the panel's own. */
export function projectOfAction(action: string): string | undefined {
    const slash = action.indexOf("/");
    return slash === -1 ? undefined : action.slice(0, slash);
}

/** Why this action id can't be registered, or null when it can. */
export function actionIdProblem(action: string): string | null {
    const slash = action.indexOf("/");
    if (slash === -1) return null;
    const project = action.slice(0, slash);
    const rest = action.slice(slash + 1);
    if (!PROJECT_ID_PATTERN.test(project)) return `"${project}" is not a valid project id`;
    if (!rest || rest.includes("/")) return `"${action}" must be "project/action", with one slash`;
    return null;
}

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
    // undefined when the caller opted out of a deadline (timeoutMs null):
    // teardown then depends on the reply or the socket closing
    timer: ReturnType<typeof setTimeout> | undefined;
    callerWs: WebSocket;
    // the socket the action is registered on: the only socket whose
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
// is already owned by a different socket
export type RegistryResult =
    | { ok: true }
    | { ok: false; code: "CONFLICT"; owner: WebSocket };

/** A refused project definition or project action: answered INVALID_PARAMS. */
export class ProjectError extends Error {
    readonly code = ErrorCode.INVALID_PARAMS;
    name = "ProjectError";
}

/**
 * What a registry asks about panel services that sleep (panelServices.ts): a
 * service with nothing to do is stopped, and what it registered stays listed
 * so the next call starts it again.
 */
export interface ServiceSleeper {
    /** the panel's service is asleep, or on its way there */
    asleep(panelId: string): boolean;
    /** starts it again; resolves once it is ready and has registered */
    wake(panelId: string): Promise<void>;
    /** something called the panel's service, or it answered */
    touch(panelId: string): void;
}

/** What a sleeping service had registered. */
interface DormantPanel {
    actions: Map<string, { panelId: string; action: string; schema?: any }>;
    projects: Map<string, ActionProject>;
}

/**
 * Which registry this is. Actions (v1) and Blocks (v2) are separate
 * registries over the same machinery: their names never collide, and a
 * Blocks call frame names its registry so the panel's transport dispatches
 * it to its own handlers.
 */
export type RegistryKind = "action" | "block";

export class ActionsRegistry {
    private readonly noun: string;
    private readonly Noun: string;
    private readonly article: string;
    private readonly tag: string;

    constructor(readonly kind: RegistryKind = "action") {
        this.noun = kind;
        this.Noun = kind === "action" ? "Action" : "Block";
        this.article = kind === "action" ? "An" : "A";
        this.tag = kind === "action" ? "Actions" : "Blocks";
    }

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
    // projects keyed "panelId:projectId", owned by the socket that defined them
    private projects = new Map<string, RegisteredProject>();
    private socketProjects = new Map<WebSocket, Set<string>>();
    // what each sleeping service had registered, by panel: listed like the
    // rest, and a call to one of them wakes the service first
    private dormant = new Map<string, DormantPanel>();
    private sleeper: ServiceSleeper | null = null;

    public setSleeper(sleeper: ServiceSleeper | null): void {
        this.sleeper = sleeper;
    }

    /**
     * Remembers what a service registered over these sockets, as it is put to
     * sleep. Bounded by the registry's own caps: every entry was registered.
     */
    public hibernate(panelId: string, sockets: ReadonlySet<WebSocket>): void {
        const kept: DormantPanel = { actions: new Map(), projects: new Map() };
        for (const [key, entry] of this.actions) {
            if (entry.panelId === panelId && sockets.has(entry.ws)) kept.actions.set(key, { panelId, action: entry.action, schema: entry.schema });
        }
        for (const [key, p] of this.projects) {
            if (p.panelId !== panelId || !sockets.has(p.ws)) continue;
            kept.projects.set(key, { panelId, id: p.id, name: p.name, ...(p.icon ? { icon: p.icon } : {}), ...(p.image ? { image: p.image } : {}) });
        }
        this.dormant.set(panelId, kept);
    }

    /** Forgets a sleeping service's registrations: it is awake again, or gone. True when there were any. */
    public forget(panelId: string): boolean {
        const kept = this.dormant.get(panelId);
        this.dormant.delete(panelId);
        return !!kept && (kept.actions.size > 0 || kept.projects.size > 0);
    }

    /** A call to this panel is still waiting for its answer. */
    public hasPendingCalls(panelId: string): boolean {
        for (const pending of this.pendingCalls.values()) {
            if (pending.panelId === panelId) return true;
        }
        return false;
    }

    private actionKey(panelId: string, action: string): string {
        return `${panelId}:${action}`;
    }

    // throws LimitError when adding these keys for ws would pass a cap;
    // re-registering a key the socket already owns adds nothing
    private assertRoom(ws: WebSocket, keys: string[]): void {
        const owned = this.socketActions.get(ws);
        const added = new Set(keys.filter((key) => !owned?.has(key) && !this.actions.has(key))).size;
        if ((owned?.size ?? 0) + added > MAX_ACTIONS_PER_SOCKET) {
            throw new LimitError(`A connection may register at most ${MAX_ACTIONS_PER_SOCKET} ${this.noun}s`);
        }
        if (this.actions.size + added > MAX_ACTIONS) {
            throw new LimitError(`The ${this.noun} registry is full (${MAX_ACTIONS} ${this.noun}s)`);
        }
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
                `[${this.tag}] Refused to register "${actionName}" for panel "${panelId}": already registered by another socket`,
            );
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }
        this.assertProjectOwned(panelId, actionName, ws);
        if (schema !== undefined && Buffer.byteLength(JSON.stringify(schema) ?? "", "utf8") > MAX_ACTION_SCHEMA_BYTES) {
            throw new LimitError(`${this.article} ${this.noun} schema may be at most ${MAX_ACTION_SCHEMA_BYTES} bytes`);
        }
        this.assertRoom(ws, [key]);

        this.actions.set(key, { panelId, action: actionName, schema, ws });

        let set = this.socketActions.get(ws);
        if (!set) {
            set = new Set();
            this.socketActions.set(ws, set);
        }
        set.add(key);

        logger.info(
            `[${this.tag}] Registered ${this.noun} "${actionName}" for panel "${panelId}"`,
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
                    `[${this.tag}] Refused batch registration for panel "${panelId}": ${this.noun} "${actionName}" already registered by another socket`,
                );
                return { ok: false, code: "CONFLICT", owner: existing.ws };
            }
        }
        for (const actionName of actionNames) this.assertProjectOwned(panelId, actionName, ws);
        // the whole batch fits or none of it registers
        this.assertRoom(ws, actionNames.map((name) => this.actionKey(panelId, name)));
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
                    `[${this.tag}] Refused to unregister "${actionName}" for panel "${panelId}": registered by another socket`,
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

    // a project action may only be registered into a project this socket
    // defined for this panel: removing the project then removes it too
    private assertProjectOwned(panelId: string, actionName: string, ws: WebSocket): void {
        const problem = actionIdProblem(actionName);
        if (problem) throw new ProjectError(problem);
        const project = projectOfAction(actionName);
        if (project === undefined) return;
        const owner = this.projects.get(this.actionKey(panelId, project));
        if (!owner || owner.ws !== ws) {
            throw new ProjectError(
                `Project "${project}" is not defined for panel "${panelId}" on this connection; define it before registering "${actionName}"`,
            );
        }
    }

    /**
     * Defines a project, or renames one this socket already owns. Its actions
     * are registered afterwards as "project/action".
     */
    public defineProject(panelId: string, project: { id: string; name: string; icon?: string; image?: string }, ws: WebSocket): RegistryResult {
        if (!PROJECT_ID_PATTERN.test(project.id)) throw new ProjectError(`"${project.id}" is not a valid project id`);
        if (project.image !== undefined) {
            if (project.image.length > MAX_PROJECT_IMAGE) throw new ProjectError(`Project "${project.id}"'s picture may be at most ${MAX_PROJECT_IMAGE / 1024} KB`);
            if (!isProjectImage(project.image)) {
                throw new ProjectError(`Project "${project.id}"'s picture must be an image file in the panel's folder or a base64 data:image URL`);
            }
        }
        const name = project.name.trim();
        if (!name) throw new ProjectError(`Project "${project.id}" needs a name`);
        if (name.length > MAX_PROJECT_NAME) throw new ProjectError(`A project name may be at most ${MAX_PROJECT_NAME} characters`);
        const key = this.actionKey(panelId, project.id);
        const existing = this.projects.get(key);
        if (existing && existing.ws !== ws) {
            logger.warn(`[${this.tag}] Refused to define project "${project.id}" for panel "${panelId}": defined by another socket`);
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }
        if (!existing) {
            const owned = this.socketProjects.get(ws)?.size ?? 0;
            if (owned >= MAX_PROJECTS_PER_SOCKET) {
                throw new LimitError(`A connection may define at most ${MAX_PROJECTS_PER_SOCKET} projects`);
            }
            if (this.projects.size >= MAX_PROJECTS) {
                throw new LimitError(`The project registry is full (${MAX_PROJECTS} projects)`);
            }
        }
        this.projects.set(key, { panelId, id: project.id, name, ...(project.icon ? { icon: project.icon } : {}), ...(project.image ? { image: project.image } : {}), ws });
        let set = this.socketProjects.get(ws);
        if (!set) {
            set = new Set();
            this.socketProjects.set(ws, set);
        }
        set.add(key);
        logger.info(`[${this.tag}] ${existing ? "Updated" : "Defined"} project "${project.id}" for panel "${panelId}"`);
        return { ok: true };
    }

    /** Removes a project and every action registered into it. */
    public removeProject(panelId: string, projectId: string, ws: WebSocket): RegistryResult {
        const key = this.actionKey(panelId, projectId);
        const existing = this.projects.get(key);
        if (!existing) return { ok: true };
        if (existing.ws !== ws) {
            logger.warn(`[${this.tag}] Refused to remove project "${projectId}" for panel "${panelId}": defined by another socket`);
            return { ok: false, code: "CONFLICT", owner: existing.ws };
        }
        this.dropProject(key, existing);
        logger.info(`[${this.tag}] Removed project "${projectId}" for panel "${panelId}"`);
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
            list.push({ panelId: p.panelId, id: p.id, name: p.name, ...(p.icon ? { icon: p.icon } : {}), ...(p.image ? { image: p.image } : {}) });
        }
        for (const [panelId, kept] of this.dormant) {
            if (filterPanelId && panelId !== filterPanelId) continue;
            for (const [key, project] of kept.projects) {
                if (!this.projects.has(key)) list.push({ ...project });
            }
        }
        return list;
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
        const projectKeys = this.socketProjects.get(ws);
        if (projectKeys && projectKeys.size > 0) {
            for (const key of projectKeys) this.projects.delete(key);
            changed = true;
        }
        this.socketProjects.delete(ws);

        // drop pending calls tied to this socket
        for (const [callId, pending] of this.pendingCalls.entries()) {
            if (pending.callerWs === ws) {
                clearTimeout(pending.timer);
                this.pendingCalls.delete(callId);
                // the caller is gone: nobody will return, but the promise
                // must still settle — a stuck call is a leaked slot
                pending.reject(
                    new Error(
                        `${this.Noun} call "${pending.panelId}:${pending.action}" aborted: caller socket closed`,
                    ),
                );
            } else if (pending.carried && pending.targetWs === ws) {
                // the operation that stopped this socket answers the call
                // (finishCarried), so it stays pending
            } else {
                const key = this.actionKey(pending.panelId, pending.action);
                const reg = this.actions.get(key);
                if (!reg || reg.ws === ws) {
                    clearTimeout(pending.timer);
                    this.pendingCalls.delete(callId);
                    pending.reject(
                        new Error(
                            `${this.Noun} service for "${pending.panelId}:${pending.action}" disconnected`,
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
        timeoutMs: number | null = 30_000,
        callerPanelId: string | null = null,
    ): Promise<unknown> {
        const key = this.actionKey(panelId, action);
        const refuseInternal = (schema: any) => {
            if (schema?.internal !== true || callerPanelId === null || callerPanelId === panelId) return;
            logger.warn(`[${this.tag}] "${callerPanelId}" refused internal ${this.noun} "${panelId}:${action}"`);
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `${this.Noun} "${action}" is internal to panel "${panelId}"`,
            );
        };
        // a sleeping service is started by the call that needs it; a caller
        // who may not make the call does not get to start anything
        if (this.sleeper?.asleep(panelId)) {
            // still registered while the service is on its way to sleep
            const known = this.dormant.get(panelId)?.actions.get(key) ?? this.actions.get(key);
            if (known) {
                refuseInternal(known.schema);
                await this.sleeper.wake(panelId);
            }
        }
        const registered = this.actions.get(key);
        if (!registered || registered.ws.readyState !== WebSocket.OPEN) {
            throw new Error(
                `${this.Noun} "${action}" on panel "${panelId}" is not registered or unavailable`,
            );
        }
        refuseInternal(registered.schema);
        this.sleeper?.touch(panelId);

        // unguessable: a reply must name a call it was actually sent
        const callId = `call_${randomUUID()}`;

        // bounded at both scopes: a caller runaway is refused with a typed
        // error naming the cap, never queued into an unbounded map
        const globalCount = this.pendingCalls.size;
        if (globalCount >= MAX_PENDING_CALLS) {
            logger.warn(
                `[${this.tag}] Call refused: ${globalCount} outstanding calls (global cap ${MAX_PENDING_CALLS})`,
            );
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `Too many outstanding ${this.noun} calls: ${globalCount} (global cap ${MAX_PENDING_CALLS})`,
            );
        }
        const socketSet = this.socketPendingCalls.get(callerWs);
        const socketCount = socketSet?.size ?? 0;
        if (socketCount >= MAX_PENDING_CALLS_PER_SOCKET) {
            logger.warn(
                `[${this.tag}] Call refused: caller socket has ${socketCount} outstanding calls (per-socket cap ${MAX_PENDING_CALLS_PER_SOCKET})`,
            );
            throw new RpcError(
                ErrorCode.FORBIDDEN,
                `Too many outstanding ${this.noun} calls on this connection: ${socketCount} (cap ${MAX_PENDING_CALLS_PER_SOCKET})`,
            );
        }

        return new Promise((resolve, reject) => {
            // null = no deadline: the caller asked to wait for completion,
            // so no timer is armed. handleReply / handleSocketClose still
            // settle and free the slot, and the pending-call caps bound how
            // many such calls can be outstanding at once.
            const timer =
                timeoutMs === null
                    ? undefined
                    : setTimeout(() => {
                          const held = this.socketPendingCalls.get(callerWs);
                          held?.delete(callId);
                          if (held && held.size === 0) this.socketPendingCalls.delete(callerWs);
                          this.pendingCalls.delete(callId);
                          reject(
                              new Error(
                                  `${this.Noun} call "${panelId}:${action}" timed out after ${timeoutMs}ms`,
                              ),
                          );
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
            if (!socketSet) {
                this.socketPendingCalls.set(callerWs, new Set([callId]));
            } else {
                socketSet.add(callId);
            }

            try {
                registered.ws.send(
                    JSON.stringify({
                        type: "action_call",
                        ...(this.kind === "block" ? { registry: "blocks" } : {}),
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
            logger.warn(`[${this.tag}] dropped reply for "${pending.panelId}:${pending.action}" from a socket that was not called`);
            return false;
        }

        this.settle(pending, { result, error });
        return true;
    }

    private settle(pending: PendingActionCall, { result, error }: CarriedOutcome): void {
        this.pendingCalls.delete(pending.callId);
        clearTimeout(pending.timer);
        this.sleeper?.touch(pending.panelId);

        const held = this.socketPendingCalls.get(pending.callerWs);
        held?.delete(pending.callId);
        if (held && held.size === 0) {
            this.socketPendingCalls.delete(pending.callerWs);
        }

        if (error) {
            pending.reject(new Error(error));
        } else {
            pending.resolve(result);
        }
    }

    /**
     * For a service asking for something that stops the service itself (a
     * backup pauses its panel's service): the service cannot answer the
     * action call it is in the middle of, since it will be gone. The call
     * stays pending past the service's socket, and the returned function,
     * called with the operation's outcome, answers it with that when the
     * service did go away. A service that was not stopped answers its own
     * call. Null when the call is already over (answered, or timed out).
     * Only the socket the call was sent to may carry it.
     */
    public carryCall(callId: string, fromWs: WebSocket): ((outcome: CarriedOutcome) => void) | null {
        const pending = this.pendingCalls.get(callId);
        if (!pending) return null;
        if (pending.targetWs !== fromWs) {
            throw new RpcError(ErrorCode.FORBIDDEN, `That ${this.noun} call was not sent to this connection`);
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
        for (const [panelId, kept] of this.dormant) {
            if (filterPanelId && panelId !== filterPanelId) continue;
            for (const [key, entry] of kept.actions) {
                if (this.actions.has(key)) continue;
                const project = projectOfAction(entry.action);
                list.push({ panelId, action: entry.action, ...(project !== undefined ? { project } : {}), schema: entry.schema });
            }
        }
        return list;
    }
}

export const actionsRegistry = new ActionsRegistry();
/** The Blocks panel's registry (Actions API v2, PaperAPI blocksApi). */
export const blocksRegistry = new ActionsRegistry("block");
