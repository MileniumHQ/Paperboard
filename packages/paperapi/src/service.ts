import { actionsApi } from "./actions";
import { getPanelId } from "./ipc";
import { STATE_GET_ACTION, STATE_SYNC_EVENT } from "./channels";
import {
    type ActionCategory,
    type ActionCategoryDefinition,
    type ActionDefinition,
    type TriggerDefinition,
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
    triggers?: TriggerDefinition[];
    types?: CustomTypeDefinition[];
    /**
     * Section metadata for the Actions library. An action/trigger names a
     * category with `category: "Messages"`; this array supplies the icon and
     * sort order for that name.
     */
    categories?: ActionCategoryDefinition[];
    onInit?: (ctx: ServiceContext<TState>) => void | Promise<void>;
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
        emit(STATE_SYNC_EVENT, { state: patch, full: currentState });
    };

    const ctx: ServiceContext<TState> = {
        get state() {
            return currentState;
        },
        setState,
        emit,
        emitTrigger,
    };

    // internal hydration action: callable by the bridge, never a block
    actionsApi.register(
        STATE_GET_ACTION,
        () => currentState,
        panelId,
        {
            internal: true,
            name: "Get Panel State",
            description: "Hydrates the panel bridge with the service's state",
        },
    ).catch((err) => {
        console.error(`[Service:${panelId}] Failed to register hydration action '${STATE_GET_ACTION}':`, err);
    });

    if (options.actions) {
        if (Array.isArray(options.actions)) {
            for (const actionDef of options.actions) {
                const wrapped: ActionDefinition = {
                    ...actionDef,
                    category: resolveItemCategory(
                        actionDef.category,
                        options.categories,
                    ),
                    run: (_c, inputs) => actionDef.run(ctx, inputs),
                };
                actionsApi.register(wrapped, undefined, panelId).catch((err) => {
                    console.error(
                        `[Service:${panelId}] Failed to register action '${actionDef.id}':`,
                        err,
                    );
                });
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
            actionsApi.registerMultiple(registeredActions, panelId).catch((err) => {
                console.error(`[Service:${panelId}] Failed to register actions:`, err);
            });
        }
    }

    if (options.triggers) {
        for (const triggerDef of options.triggers) {
            const wrapped: TriggerDefinition = {
                ...triggerDef,
                category: resolveItemCategory(
                    triggerDef.category,
                    options.categories,
                ),
                listen: triggerDef.listen
                    ? (_c, emitFn) => triggerDef.listen!(ctx, emitFn)
                    : undefined,
            };
            actionsApi.registerTrigger(wrapped, panelId).catch((err) => {
                console.error(
                    `[Service:${panelId}] Failed to register trigger '${triggerDef.id}':`,
                    err,
                );
            });
        }
    }

    if (options.onInit) {
        Promise.resolve(options.onInit(ctx)).catch((err) => {
            console.error(`[Service:${panelId}] onInit error:`, err);
        });
    }

    return {
        panelId,
        ctx,
        getState: () => currentState,
        setState,
    };
}
