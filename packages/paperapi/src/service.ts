import { actionsApi } from "./actions";
import { getPanelId } from "./ipc";
import { STATE_GET_ACTION, STATE_SYNC_EVENT, WIDGET_CHOICES_ACTION } from "./channels";
import { parseWidgetChoices, type WidgetChoice } from "./widgetManifest";
import {
    type ActionCategory,
    type ActionCategoryDefinition,
    type ActionDefinition,
    type CustomTypeDefinition,
    defineType,
} from "./schema";

/**
 * Resolves an item's category string against the panel's declared category
 * array, so a panel writes the metadata (icon, order) once and each action
 * only names the category.
 */
export function resolveItemCategory(
    category: ActionCategory | undefined,
    categories: ActionCategoryDefinition[] | undefined,
): ActionCategory | undefined {
    if (typeof category !== "string" || !categories || categories.length === 0) {
        return category;
    }
    const match = categories.find((entry) => entry.name === category);
    return match ? { ...match } : category;
}

export interface ServiceContext<TState> {
    state: TState;
    setState: (
        patchOrUpdater:
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => void;
    emit: (event: string, payload?: unknown) => void;
    emitTrigger: <T = any>(triggerId: string, output: T) => void;
}

export interface DefinePanelServiceOptions<
    TState extends Record<string, any>,
    TActions extends
        | Record<
              string,
              (ctx: ServiceContext<TState>, ...args: any[]) => Promise<any> | any
          >
        | ActionDefinition[],
> {
    id?: string;
    state?: TState;
    actions?: TActions;
    types?: CustomTypeDefinition[];
    /**
     * Section metadata for the Actions library. An action/trigger names a
     * category with `category: "Messages"`; this array supplies the icon and
     * sort order for that name.
     */
    categories?: ActionCategoryDefinition[];
    /**
     * What each widget option's dropdown offers in Home's gallery, by widget
     * id then option id, as the manifest declares them. Asked each time the
     * gallery shows the widget, so the list is always current.
     */
    widgetChoices?: Record<
        string,
        Record<string, (ctx: ServiceContext<TState>) => WidgetChoice[] | Promise<WidgetChoice[]>>
    >;
    onInit?: (ctx: ServiceContext<TState>) => void | Promise<void>;
    /**
     * Gets the service ready for a backup of its panel's data, which starts
     * once this resolves: the service is then stopped, the data copied, and
     * the service started again. Use it to write out what is in memory and
     * to stop a process the service runs from writing (a game server's
     * save-off); undo that when the service starts again. Throwing refuses
     * the backup. Without it the service is simply stopped for the copy.
     */
    beforeBackup?: (ctx: ServiceContext<TState>) => void | Promise<void>;
}

export function definePanelService<
    TState extends Record<string, any>,
    TActions extends
        | Record<
              string,
              (ctx: ServiceContext<TState>, ...args: any[]) => Promise<any> | any
          >
        | ActionDefinition[],
>(options: DefinePanelServiceOptions<TState, TActions>) {
    const panelId = options.id || getPanelId();
    // identity is threaded as a parameter everywhere; writing it back to
    // process.env gives two services in one process the same name
    let currentState = { ...(options.state || {}) } as TState;

    if (options.types) {
        for (const typeDef of options.types) {
            defineType(typeDef);
        }
    }

    const emit = (event: string, payload?: unknown) => {
        actionsApi.emit(event, payload, panelId).catch((err) => {
            console.error(
                `[Service:${panelId}] Failed to emit event '${event}':`,
                err,
            );
        });
    };

    const emitTrigger = <T = any>(triggerId: string, output: T) => {
        actionsApi.emitTrigger(triggerId, output, panelId).catch((err) => {
            console.error(
                `[Service:${panelId}] Failed to emit trigger '${triggerId}':`,
                err,
            );
        });
    };

    const setState = (
        patchOrUpdater:
            | Partial<TState>
            | ((prev: TState) => Partial<TState>),
    ) => {
        const patch =
            typeof patchOrUpdater === "function"
                ? patchOrUpdater(currentState)
                : patchOrUpdater;
        currentState = { ...currentState, ...patch };
        emit(STATE_SYNC_EVENT, { state: patch });
    };

    const ctx: ServiceContext<TState> = {
        get state() {
            return currentState;
        },
        setState,
        emit,
        emitTrigger,
    };

    const registrations: Promise<void>[] = [];
    // internal hydration action: callable by the bridge, never a block
    registrations.push(actionsApi.register(
        STATE_GET_ACTION,
        async () => { await ready; return currentState; },
        panelId,
        {
            internal: true,
            name: "Get Panel State",
            description: "Hydrates the panel bridge with the service's state",
        },
    ));

    if (options.widgetChoices) {
        const widgetChoices = options.widgetChoices;
        // internal: Home's gallery calls it, never a block
        registrations.push(actionsApi.register(
            WIDGET_CHOICES_ACTION,
            async (inputs: { widgetId?: unknown; optionId?: unknown } | undefined) => {
                await ready;
                const widgetId = String(inputs?.widgetId);
                const optionId = String(inputs?.optionId);
                const supply = Object.hasOwn(widgetChoices, widgetId) && Object.hasOwn(widgetChoices[widgetId], optionId)
                    ? widgetChoices[widgetId][optionId]
                    : undefined;
                if (!supply) throw new Error(`This panel's service offers no choices for widget "${widgetId}" option "${optionId}"`);
                return parseWidgetChoices(await supply(ctx));
            },
            panelId,
            {
                internal: true,
                name: "Get Widget Choices",
                description: "Lists what a widget option offers in Home's gallery",
            },
        ));
    }

    if (options.actions) {
        if (Array.isArray(options.actions)) {
            for (const actionDef of options.actions) {
                const wrapped: ActionDefinition = {
                    ...actionDef,
                    category: resolveItemCategory(
                        actionDef.category,
                        options.categories,
                    ),
                    run: actionDef.run
                        ? (_c: any, inputs: any) => actionDef.run!(ctx, inputs)
                        : undefined,
                    listen: actionDef.listen
                        ? (_c: any, emitFn: (output: any) => void) =>
                              actionDef.listen!(ctx, emitFn)
                        : undefined,
                };
                registrations.push(actionsApi.register(wrapped, undefined, panelId));
            }
        } else {
            const registeredActions: Record<
                string,
                (...args: any[]) => Promise<any> | any
            > = {};
            for (const [actionName, actionFn] of Object.entries(options.actions)) {
                registeredActions[actionName] = (...args: any[]) =>
                    actionFn(ctx, ...args);
            }
            registrations.push(actionsApi.registerMultiple(registeredActions, panelId));
        }
    }

    const ready = Promise.all(registrations).then(async () => {
        await options.onInit?.(ctx);
        if (typeof process !== "undefined" && typeof process.send === "function") {
            const beforeBackup = options.beforeBackup;
            if (beforeBackup) {
                // the daemon asks once per backup and waits for the answer
                process.on("message", (message: any) => {
                    if (message?.type !== "paperboard:before-backup" || typeof message.requestId !== "string") return;
                    void (async () => beforeBackup(ctx))().then(
                        () => process.send?.({ type: "paperboard:before-backup-done", requestId: message.requestId }),
                        (err) => process.send?.({
                            type: "paperboard:before-backup-done",
                            requestId: message.requestId,
                            error: err instanceof Error ? err.message : String(err),
                        }),
                    );
                });
            }
            process.send({ type: "paperboard:service-ready", panelId, beforeBackup: Boolean(beforeBackup) });
        }
    });
    void ready.catch((err) => console.error(`[Service:${panelId}] initialization failed:`, err));

    return {
        panelId,
        ready,
        ctx,
        getState: () => currentState,
        setState,
    };
}
