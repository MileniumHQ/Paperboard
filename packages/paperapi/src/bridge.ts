import { actionsApi } from "./actions";
import { getPanelId } from "./ipc";
import { STATE_GET_ACTION, STATE_SYNC_EVENT } from "./channels";

export interface PanelBridgeOptions<TState extends Record<string, any>> {
    panelId?: string;
    defaultState?: TState;
}

export function createPanelBridge<
    TState extends Record<string, any> = Record<string, any>,
    TActions extends Record<string, (...args: any[]) => Promise<any>> = Record<
        string,
        (...args: any[]) => Promise<any>
    >,
>(options: PanelBridgeOptions<TState> = {}) {
    const panelId = options.panelId || getPanelId();
    let localState: TState = { ...(options.defaultState || {}) } as TState;
    const listeners = new Set<(patch: Partial<TState>, full: TState) => void>();

    // the subscription is tearable: createPanelBridge returns dispose()
    const unsubscribeSync = actionsApi.on(panelId, STATE_SYNC_EVENT, (payload: any) => {
        if (payload?.state) {
            localState = { ...localState, ...payload.state };
            for (const cb of listeners) {
                cb(payload.state, localState);
            }
        }
    });

    const refreshState = async (): Promise<TState> => {
        try {
            const fetched = await actionsApi.call<TState>(
                panelId,
                STATE_GET_ACTION,
            );
            if (fetched && typeof fetched === "object") {
                localState = { ...localState, ...fetched };
                for (const cb of listeners) {
                    cb(fetched, localState);
                }
            }
        } catch (err) {
            // service may still be booting — logged, and the bridge keeps
            // serving the last-known (possibly default) state meanwhile
            console.debug(`[bridge:${panelId}] refreshState deferred, service may be booting:`, err);
        }
        return localState;
    };

    refreshState();

    const onStateChange = (
        cb: (patch: Partial<TState>, full: TState) => void,
    ): (() => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
    };

    // proxy so bridge.actions.name(args) works
    const actionsProxy = new Proxy({} as TActions, {
        get(_target, prop) {
            // Promise-protocol inspection (`then`, symbol props like
            // toPrimitive/asyncIterator) must not fire a bogus action call —
            // only real string action names proxy through
            if (prop === "then" || typeof prop !== "string") return undefined;
            return (...args: any[]) => actionsApi.call(panelId, prop, ...args);
        },
    });

    // teardown for the whole bridge: unsubscriber + listener set. bridges
    // outliving their component previously leaked the transport
    // subscription forever (bounded everything).
    const dispose = (): void => {
        unsubscribeSync();
        listeners.clear();
    };

    return {
        panelId,
        getState: () => localState,
        refreshState,
        onStateChange,
        actions: actionsProxy,
        call: <R = unknown>(actionName: string, ...args: any[]): Promise<R> =>
            actionsApi.call<R>(panelId, actionName, ...args),
        dispose,
    };
}
