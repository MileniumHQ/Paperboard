import { getTransport, getPanelId } from "./ipc";
import { debugErr } from "./debug";
import {
    type ActionDefinition,
    type ActionSchema,
    type CustomTypeDefinition,
    defineType,
    listTypes,
    isTypeCompatible,
    defineAction,
    validateActionDefinition,
    assertActionInputs,
    referencedTypeInfo,
} from "./schema";

export * from "./schema";

export interface ActionInfo {
    panelId: string;
    /** the registered id; a project's actions are "project/action" */
    action: string;
    /** the project the action belongs to; absent on the panel's own (global) actions */
    project?: string;
    schema?: ActionSchema;
}

/** A panel's named set of actions: one game server, one bot. */
export interface ProjectInfo {
    panelId: string;
    id: string;
    name: string;
    icon?: string;
}

export interface ProjectDefinition {
    /** stable id: letters, digits, ".", "_" and "-", at most 64; never shown */
    id: string;
    /** what the Actions library's project dropdown shows */
    name: string;
    /** a Material Symbols name */
    icon?: string;
}

export interface RegisterOptions {
    internal?: boolean;
    name?: string;
    description?: string;
    /** registers into this project, as "project/action" */
    project?: string;
}

/** The id a project's action is registered, called and fired under. */
export function projectActionId(project: string, action: string): string {
    return `${project}/${action}`;
}

/**
 * One project's actions, bound to a panel. Everything it registers, calls
 * and fires is that project's "project/action".
 */
export interface ActionProjectHandle {
    readonly id: string;
    readonly panelId: string;
    actionId(action: string): string;
    register(actionOrName: string | ActionDefinition, handler?: (...args: any[]) => Promise<any> | any, options?: Omit<RegisterOptions, "project">): Promise<void>;
    registerMultiple(defs: ActionDefinition[]): Promise<void>;
    unregister(action: string): Promise<void>;
    emitTrigger<T = any>(trigger: string, output: T): Promise<void>;
    call<T = unknown>(action: string, inputs?: any, options?: ActionCallOptions): Promise<T>;
    /** renames the project, or changes its icon, keeping its actions */
    update(project: Omit<ProjectDefinition, "id">): Promise<void>;
    /** removes the project and every action in it */
    remove(): Promise<void>;
}

export interface ActionEventPayload<T = unknown> {
    panelId: string;
    event: string;
    payload?: T;
}

export interface TriggerEventPayload<T = unknown> {
    panelId: string;
    trigger: string;
    output: T;
}

export interface ActionCallOptions {
    /**
     * How long the call may wait for the action to finish, in milliseconds.
     * Defaults to 30_000; the daemon refuses a numeric value above 60_000.
     * `null` opts out of the deadline and waits for completion — for actions
     * that legitimately run long (installing a runtime, a large download).
     * Such a call is still bounded by the transport's outstanding-call cap.
     * Any other fields are forwarded to the handler as its second argument.
     */
    timeoutMs?: number | null;
    [key: string]: unknown;
}

export const actionsApi = {
    defineAction,

    defineType,

    listTypes,

    isTypeCompatible,

    /**
     * Calls an action registered on a target panel (or the current panel).
     *
     * `options.timeoutMs` overrides the default 30 s deadline; pass `null`
     * for an action that runs long and should be waited out (the daemon's
     * outstanding-call cap still bounds how many such calls queue). The
     * remaining option fields are forwarded to the handler unchanged.
     */
    call: async <T = unknown>(
        targetPanel: string,
        actionName: string,
        inputs?: any,
        options?: ActionCallOptions,
    ): Promise<T> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const { timeoutMs = 30_000, ...handlerOptions } = options ?? {};
        const res = await transport.call(
            "actions:call",
            {
                panelId: targetPanel,
                action: actionName,
                args: [inputs, Object.keys(handlerOptions).length ? handlerOptions : undefined],
                timeoutMs,
            },
            timeoutMs,
        );
        return res?.result as T;
    },

    /**
     * Registers an action handler and its schema for the current panel.
     * The by-name form takes schema hints as `options`, so control-plane
     * handlers (state hydration, config reload) can declare themselves
     * internal without a full definition.
     *
     * One kind, two shapes:
     * - `run` → a plain callable action.
     * - `listen` (or neither) → an event action: it fires events and
     *   starts flows, is not callable and cannot nest (stamped `eventOnly`).
     */
    register: async (
        actionOrName: string | ActionDefinition,
        maybeHandler?: (...args: any[]) => Promise<any> | any,
        panelId?: string,
        options?: RegisterOptions,
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        const project = options?.project;
        const fullId = (id: string) => (project ? projectActionId(project, id) : id);
        if (!pid) {
            throw new Error(
                "Cannot register action without a panel context (panel ID not found)",
            );
        }

        // a broken definition is refused before anything touches the wire
        if (typeof actionOrName === "object" && actionOrName !== null) {
            validateActionDefinition(actionOrName as ActionDefinition);
        }

        const transport = getTransport();
        await transport.ensureConnected();

        if (typeof actionOrName === "object" && actionOrName !== null) {
            const def = actionOrName as ActionDefinition;
            const actionName = fullId(def.id);
            const schema: ActionSchema = {
                id: actionName,
                name: def.name,
                description: def.description || "",
                internal: def.internal,
                hidden: def.hidden,
                deprecated: def.deprecated,
                template: def.template || def.writtenOut,
                writtenOut: def.writtenOut || def.template,
                category: def.category,
                inputs: def.inputs,
                output: def.output,
                outputFields: def.outputFields,
                quick: def.quick,
                icon: def.icon,
                eventOnly: def.run ? undefined : true,
                match: def.match,
                types: referencedTypeInfo(def),
            };

            const handler = def.run
                ? (inputs: any) => {
                      assertActionInputs(def.inputs, inputs);
                      return def.run!({ panelId: pid }, inputs);
                  }
                : () => {
                      throw new Error(
                          `Action "${actionName}" fires as an event and is not callable`,
                      );
                  };
            await transport.registerAction(pid, actionName, handler, schema);

            if (def.listen) {
                def.listen({ panelId: pid }, (output) => {
                    actionsApi.emitTrigger(actionName, output, pid);
                });
            }
        } else {
            const actionName = fullId(actionOrName as string);
            const handler = maybeHandler || (() => {});
            const schema: ActionSchema | undefined = options
                ? {
                      id: actionName,
                      name: options.name || actionName,
                      description: options.description || "",
                      internal: options.internal,
                      template: options.name || actionName,
                  }
                : undefined;
            await transport.registerAction(pid, actionName, handler, schema);
        }
    },

    /**
     * Registers multiple action definitions or handlers.
     */
    registerMultiple: async (
        actionsMapOrList:
            | Record<string, (...args: any[]) => Promise<any> | any>
            | ActionDefinition[],
        panelId?: string,
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        if (Array.isArray(actionsMapOrList)) {
            for (const def of actionsMapOrList) {
                await actionsApi.register(def, undefined, pid);
            }
        } else {
            for (const [name, handler] of Object.entries(actionsMapOrList)) {
                await actionsApi.register(name, handler, pid);
            }
        }
    },

    /**
     * Defines a project on the current panel, or renames one it defined, and
     * returns its handle. Register the project's actions through the handle:
     * each is its own "project/action", so two projects sharing nothing is
     * the model (share the code behind them instead). Projects come and go
     * at any time; a flow block of a removed project fails when it runs.
     */
    defineProject: async (project: ProjectDefinition, panelId?: string): Promise<ActionProjectHandle> => {
        const pid = panelId || getPanelId();
        if (!pid) throw new Error("Cannot define a project without a panel context (panel ID not found)");
        const transport = getTransport();
        await transport.defineProject(pid, { id: project.id, name: project.name, ...(project.icon ? { icon: project.icon } : {}) });
        return actionsApi.project(project.id, pid);
    },

    /** A handle on a project this panel defined, without touching the wire. */
    project: (projectId: string, panelId?: string): ActionProjectHandle => {
        const pid = panelId || getPanelId();
        if (!pid) throw new Error("Cannot use a project without a panel context (panel ID not found)");
        return {
            id: projectId,
            panelId: pid,
            actionId: (action) => projectActionId(projectId, action),
            register: (actionOrName, handler, options) =>
                actionsApi.register(actionOrName, handler, pid, { ...options, project: projectId }),
            registerMultiple: async (defs) => {
                for (const def of defs) await actionsApi.register(def, undefined, pid, { project: projectId });
            },
            unregister: (action) => actionsApi.unregister(projectActionId(projectId, action), pid),
            emitTrigger: (trigger, output) => actionsApi.emitTrigger(projectActionId(projectId, trigger), output, pid),
            call: (action, inputs, options) => actionsApi.call(pid, projectActionId(projectId, action), inputs, options),
            update: async (next) => {
                await actionsApi.defineProject({ id: projectId, ...next }, pid);
            },
            remove: () => actionsApi.removeProject(projectId, pid),
        };
    },

    /** Removes a project of the current panel and every action in it. */
    removeProject: async (projectId: string, panelId?: string): Promise<void> => {
        const pid = panelId || getPanelId();
        const transport = getTransport();
        await transport.removeProject(pid, projectId);
    },

    /** Lists the projects panels define, or one panel's. */
    listProjects: async (filterPanelId?: string): Promise<ProjectInfo[]> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("actions:projects", { panelId: filterPanelId });
        return (res?.projects || []) as ProjectInfo[];
    },

    /**
     * Unregisters an action from the current panel.
     */
    unregister: async (actionName: string, panelId?: string): Promise<void> => {
        const pid = panelId || getPanelId();
        const transport = getTransport();
        await transport.unregisterAction(pid, actionName);
    },

    /**
     * Subscribes to changes in the action/trigger registry.
     */
    onRegistryChange: (callback: (data?: any) => void): (() => void) => {
        const transport = getTransport();
        const listener = (data: any) => {
            callback(data);
        };
        transport.subscribeEvent("actions:registry-updated", listener);
        transport.ensureConnected().catch((err) => debugErr("ensure connected on subscribe", err));
        return () => {
            transport.unsubscribeEvent("actions:registry-updated", listener);
        };
    },

    /**
     * Lists all registered actions across panels with rich schemas. Event
     * actions (stamped `eventOnly`) and dual actions (carrying `event`) are
     * part of the same registry and list.
     */
    list: async (filterPanelId?: string): Promise<ActionInfo[]> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("actions:list", {
            panelId: filterPanelId,
        });
        return (res?.actions || []) as ActionInfo[];
    },

    /**
     * Broadcasts an event from the current panel.
     */
    emit: async (
        eventName: string,
        payload?: unknown,
        panelId?: string,
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        const transport = getTransport();
        await transport.ensureConnected();
        await transport.call("actions:emit", {
            panelId: pid,
            event: eventName,
            payload,
        });
    },

    /**
     * Fires a trigger event with its output payload.
     */
    emitTrigger: async <T = any>(
        triggerId: string,
        output: T,
        panelId?: string,
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        const transport = getTransport();
        await transport.ensureConnected();
        await transport.call("triggers:emit", {
            panelId: pid,
            trigger: triggerId,
            output,
        });
    },

    /**
     * Subscribes to general action events.
     */
    on: (
        panelOrEvent: string,
        eventOrCallback: string | ((payload: any) => void),
        maybeCallback?: (payload: any) => void,
    ): (() => void) => {
        const transport = getTransport();

        let targetPanel = "";
        let targetEvent = "";
        let callback: (payload: any) => void;

        if (typeof eventOrCallback === "function") {
            // the two-arg form is "my panel's event": same discipline as
            // onTrigger — unresolvable identity must throw, not silently
            // subscribe to a filter that can never match
            targetPanel = getPanelId();
            if (!targetPanel) {
                throw new Error(
                    `[paperapi] actions.on("${panelOrEvent}", ...) could not resolve this panel's id. ` +
                        "Pass the explicit panel id: on(\"panel.id\", \"event\", cb).",
                );
            }
            targetEvent = panelOrEvent;
            callback = eventOrCallback;
        } else {
            targetPanel = panelOrEvent;
            targetEvent = eventOrCallback;
            callback = maybeCallback || (() => {});
        }

        if (targetEvent === "*" || targetPanel === "*") {
            throw new Error(
                '[paperapi] actions.on does not accept "*": subscribe to an explicit panel id and event name.',
            );
        }

        const source = `actions:${targetPanel}:${targetEvent}`;
        const scopedListener = (payload: any) => callback(payload);
        transport.subscribeEvent(source, scopedListener);
        transport.ensureConnected().catch((err) => debugErr("ensure connected on subscribe", err));

        return () => {
            transport.unsubscribeEvent(source, scopedListener);
        };
    },

    /**
     * Listens to when a specific trigger fires.
     *
     * Usage:
     * - `actions.onTrigger("player-joined", (event) => ...)`
     * - `actions.onTrigger("com.example.game", "player-joined", (event) => ...)`
     */
    onTrigger: <T = any>(
        panelOrTrigger: string,
        triggerOrCallback: string | ((output: T, payload: TriggerEventPayload<T>) => void),
        maybeCallback?: (output: T, payload: TriggerEventPayload<T>) => void,
    ): (() => void) => {
        const transport = getTransport();

        let targetPanel = "";
        let targetTrigger = "";
        let callback: (output: T, payload: TriggerEventPayload<T>) => void;

        if (typeof triggerOrCallback === "function") {
            // the two-arg form is "my panel's trigger": identity defaults to
            // the transport's own resolved panel id, never the wildcard —
            // a deprecated scope must not be an implicit default. Panels
            // listening to OTHER panels pass the explicit three-arg form.
            targetPanel = transport.getDefaultPanelId();
            if (!targetPanel) {
                throw new Error(
                    `[paperapi] actions.onTrigger("${panelOrTrigger}", ...) could not resolve this panel's id. ` +
                        "Pass the explicit panel id: onTrigger(\"panel.id\", \"trigger\", cb).",
                );
            }
            targetTrigger = panelOrTrigger;
            callback = triggerOrCallback;
        } else {
            targetPanel = panelOrTrigger;
            targetTrigger = triggerOrCallback;
            callback = maybeCallback || (() => {});
        }

        if (targetPanel === "*" || targetTrigger === "*") {
            throw new Error(
                '[paperapi] actions.onTrigger does not accept "*": subscribe to an explicit panel id and trigger name.',
            );
        }

        const source = `triggers:${targetPanel}:${targetTrigger}`;
        const scopedListener = (output: T) => callback(output, { panelId: targetPanel, trigger: targetTrigger, output });
        transport.subscribeEvent(source, scopedListener);
        transport.ensureConnected().catch((err) => debugErr("ensure connected on subscribe", err));

        return () => {
            transport.unsubscribeEvent(source, scopedListener);
        };
    },
};

export const actions = actionsApi;
