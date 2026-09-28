import { getTransport, getPanelId } from "./ipc";
import { debugErr } from "./debug";
import { warnOnce } from "./identity";
import {
    type ActionDefinition,
    type ActionSchema,
    type CustomTypeDefinition,
    defineType,
    listTypes,
    isTypeCompatible,
    defineAction,
    validateActionDefinition,
} from "./schema";

export * from "./schema";

export interface ActionInfo {
    panelId: string;
    action: string;
    schema?: ActionSchema;
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

export const actionsApi = {
    defineAction,

    defineType,

    listTypes,

    isTypeCompatible,

    /**
     * Calls an action registered on a target panel (or the current panel).
     */
    call: async <T = unknown>(
        targetPanel: string,
        actionName: string,
        inputs?: any,
        options?: any,
    ): Promise<T> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("actions:call", {
            panelId: targetPanel,
            action: actionName,
            args: [inputs, options],
        });
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
        options?: { internal?: boolean; name?: string; description?: string },
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        if (!pid) {
            throw new Error(
                "Cannot register action without a panel context (panel ID not found)",
            );
        }

        const transport = getTransport();
        await transport.ensureConnected();

        if (typeof actionOrName === "object" && actionOrName !== null) {
            const def = actionOrName as ActionDefinition;
            validateActionDefinition(def);
            const actionName = def.id;
            const schema: ActionSchema = {
                id: def.id,
                name: def.name,
                description: def.description || "",
                internal: def.internal,
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
            };

            const handler = def.run
                ? (inputs: any) => def.run!({ panelId: pid }, inputs)
                : () => {
                      throw new Error(
                          `Action "${actionName}" fires as an event and is not callable`,
                      );
                  };
            await transport.registerAction(pid, actionName, handler, schema);

            if (def.listen) {
                def.listen({ panelId: pid }, (output) => {
                    actionsApi.emitTrigger(def.id, output, pid);
                });
            }
        } else {
            const actionName = actionOrName as string;
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
            // TODO(remove after v0.2): wildcard panel/event matching dies
            // with the pre-namespaced read-through. The daemon warns; the
            // client must warn too — the deprecation has two ends of the wire.
            warnOnce(
                "paperapi:wildcard-on",
                '[paperapi] actions.on with "*" panel/event is deprecated and will be refused after v0.2; subscribe to explicit panel:event names instead.',
            );
        }

        const listener = (data: any) => {
            if (!data) return;
            if (targetEvent === "*" || targetPanel === "*") {
                callback(data);
                return;
            }            if (data.panelId === targetPanel && data.event === targetEvent) {
                callback(data.payload);
            }
        };

        const source = targetPanel === "*" || targetEvent === "*" ? "actions:event" : `actions:${targetPanel}:${targetEvent}`;
        const scopedListener = source === "actions:event" ? listener : (payload: any) => callback(payload);
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
            // TODO(remove after v0.2): see actions.on above.
            warnOnce(
                "paperapi:wildcard-onTrigger",
                '[paperapi] actions.onTrigger with "*" panel/trigger is deprecated and will be refused after v0.2; subscribe to explicit panel:trigger names instead.',
            );
        }

        const listener = (data: any) => {
            if (!data) return;
            if (targetTrigger === "*" || data.trigger === targetTrigger) {
                if (targetPanel === "*" || data.panelId === targetPanel) {
                    callback(data.output, data);
                }
            }
        };

        const source = targetPanel === "*" || targetTrigger === "*" ? "triggers:event" : `triggers:${targetPanel}:${targetTrigger}`;
        const scopedListener = source === "triggers:event" ? listener : (output: T) => callback(output, { panelId: targetPanel, trigger: targetTrigger, output });
        transport.subscribeEvent(source, scopedListener);
        transport.ensureConnected().catch((err) => debugErr("ensure connected on subscribe", err));

        return () => {
            transport.unsubscribeEvent(source, scopedListener);
        };
    },
};

export const actions = actionsApi;
