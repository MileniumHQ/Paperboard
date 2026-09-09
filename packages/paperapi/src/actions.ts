import { getTransport, getPanelId } from "./ipc";
import {
    type ActionDefinition,
    type ActionSchema,
    type TriggerDefinition,
    type TriggerSchema,
    type CustomTypeDefinition,
    defineType,
    listTypes,
    isTypeCompatible,
    defineAction,
    defineTrigger,
} from "./schema";

export * from "./schema";

export interface ActionInfo {
    panelId: string;
    action: string;
    schema?: ActionSchema;
}

export interface TriggerInfo {
    panelId: string;
    trigger: string;
    schema?: TriggerSchema;
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

    defineTrigger,

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
     */
    register: async (
        actionOrName: string | ActionDefinition,
        maybeHandler?: (...args: any[]) => Promise<any> | any,
        panelId?: string,
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
            const actionName = def.id;
            const schema: ActionSchema = {
                id: def.id,
                name: def.name,
                description: def.description || "",
                template: def.template || def.writtenOut,
                writtenOut: def.writtenOut || def.template,
                inputs: def.inputs,
                output: def.output,
                quick: def.quick,
                icon: def.icon,
            };

            await transport.registerAction(
                pid,
                actionName,
                (inputs: any) => def.run({ panelId: pid }, inputs),
                schema,
            );
        } else {
            const actionName = actionOrName as string;
            const handler = maybeHandler || (() => {});
            await transport.registerAction(pid, actionName, handler);
        }
    },

    /**
     * Registers a trigger schema for the current panel.
     */
    registerTrigger: async (
        triggerDef: TriggerDefinition,
        panelId?: string,
    ): Promise<void> => {
        const pid = panelId || getPanelId();
        if (!pid) {
            throw new Error(
                "Cannot register trigger without a panel context (panel ID not found)",
            );
        }

        const transport = getTransport();
        await transport.ensureConnected();

        const schema: TriggerSchema = {
            id: triggerDef.id,
            name: triggerDef.name,
            description: triggerDef.description || "",
            template: triggerDef.template || triggerDef.writtenOut,
            writtenOut: triggerDef.writtenOut || triggerDef.template,
            output: triggerDef.output,
            icon: triggerDef.icon,
        };

        await transport.registerTrigger(pid, triggerDef.id, schema);

        if (triggerDef.listen) {
            triggerDef.listen({ panelId: pid }, (output) => {
                actionsApi.emitTrigger(triggerDef.id, output, pid);
            });
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
     * Unregisters a trigger from the current panel.
     */
    unregisterTrigger: async (triggerName: string, panelId?: string): Promise<void> => {
        const pid = panelId || getPanelId();
        const transport = getTransport();
        await transport.unregisterTrigger(pid, triggerName);
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
        transport.ensureConnected().catch(() => {});
        return () => {
            transport.unsubscribeEvent("actions:registry-updated", listener);
        };
    },

    /**
     * Lists all registered actions across panels with rich schemas.
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
     * Lists all registered event triggers across panels with schemas.
     */
    listTriggers: async (filterPanelId?: string): Promise<TriggerInfo[]> => {
        const transport = getTransport();
        await transport.ensureConnected();
        const res = await transport.call("triggers:list", {
            panelId: filterPanelId,
        });
        return (res?.triggers || []) as TriggerInfo[];
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
            targetPanel = getPanelId();
            targetEvent = panelOrEvent;
            callback = eventOrCallback;
        } else {
            targetPanel = panelOrEvent;
            targetEvent = eventOrCallback;
            callback = maybeCallback || (() => {});
        }

        const listener = (data: any) => {
            if (!data) return;
            if (targetEvent === "*" || targetPanel === "*") {
                callback(data);
                return;
            }
            if (data.panelId === targetPanel && data.event === targetEvent) {
                callback(data.payload);
            }
        };

        transport.subscribeEvent("actions:event", listener);
        transport.ensureConnected().catch(() => {});

        return () => {
            transport.unsubscribeEvent("actions:event", listener);
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
            targetPanel = "*";
            targetTrigger = panelOrTrigger;
            callback = triggerOrCallback;
        } else {
            targetPanel = panelOrTrigger;
            targetTrigger = triggerOrCallback;
            callback = maybeCallback || (() => {});
        }

        const listener = (data: any) => {
            if (!data) return;
            if (targetTrigger === "*" || data.trigger === targetTrigger) {
                if (targetPanel === "*" || data.panelId === targetPanel) {
                    callback(data.output, data);
                }
            }
        };

        transport.subscribeEvent("triggers:event", listener);
        transport.ensureConnected().catch(() => {});

        return () => {
            transport.unsubscribeEvent("triggers:event", listener);
        };
    },
};

export const actions = actionsApi;
