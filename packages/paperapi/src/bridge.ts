import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import { STATE_EVENT, STATE_VALUE, serviceApi } from "./serviceCalls";
import { registerPanelHydrator } from "./panelHydration";

export interface PanelBridgeOptions<TState extends Record<string, any>> {
    panelId?: string;
    defaultState?: TState;
}

export function createPanelBridge<
    TState extends Record<string, any> = Record<string, any>,
    TCalls extends Record<string, (input?: any) => Promise<any>> = Record<
        string,
        (input?: any) => Promise<any>
    >,
>(options: PanelBridgeOptions<TState> = {}) {
    const panelId = options.panelId || getPanelId();
    let localState: TState = { ...(options.defaultState || {}) } as TState;
    const listeners = new Set<(patch: Partial<TState>, full: TState) => void>();
    let status: { ready: boolean; error?: string } = { ready: false };

    // the subscription is tearable: createPanelBridge returns dispose()
    const unsubscribeSync = blocksApi.onEvent(panelId, STATE_EVENT, (payload: any) => {
        if (payload?.state) {
            localState = { ...localState, ...payload.state };
            for (const cb of listeners) {
                cb(payload.state, localState);
            }
        }
    });

    const refreshState = async (): Promise<TState> => {
        try {
            const fetched = await blocksApi.read<TState>(panelId, STATE_VALUE);
            if (fetched && typeof fetched === "object") {
                status = { ready: true };
                localState = { ...localState, ...fetched };
                for (const cb of listeners) {
                    cb(fetched, localState);
                }
            }
        } catch (err) {
            // service may still be booting — logged, and the bridge keeps
            // serving the last-known (possibly default) state meanwhile
            console.debug(`[bridge:${panelId}] refreshState deferred, service may be booting:`, err);
            status = { ready: false, error: err instanceof Error ? err.message : String(err) };
            throw err;
        }
        return localState;
    };

    const unregisterHydrator = registerPanelHydrator(panelId, refreshState);
    void refreshState().catch((err) => console.debug(`[bridge:${panelId}] initial hydration failed; retry via refreshState:`, err));

    const onStateChange = (
        cb: (patch: Partial<TState>, full: TState) => void,
    ): (() => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
    };

    // proxy so bridge.calls.name(input) works
    const callsProxy = new Proxy({} as TCalls, {
        get(_target, prop) {
            // Promise-protocol inspection (`then`, symbol props like
            // toPrimitive/asyncIterator) must not fire a bogus call —
            // only real string call names proxy through
            if (prop === "then" || typeof prop !== "string") return undefined;
            return (input?: unknown) => serviceApi.call(panelId, prop, input);
        },
    });

    // teardown for the whole bridge: unsubscriber + listener set. bridges
    // outliving their component previously leaked the transport
    // subscription forever (bounded everything).
    const dispose = (): void => {
        unregisterHydrator();
        unsubscribeSync();
        listeners.clear();
    };

    return {
        panelId,
        getStatus: () => ({ ...status }),
        getState: () => localState,
        refreshState,
        onStateChange,
        calls: callsProxy,
        call: <R = unknown>(name: string, input?: unknown): Promise<R> => serviceApi.call<R>(panelId, name, input),
        /** hears an event the service emits */
        on: <T = unknown>(event: string, callback: (payload: T) => void): (() => void) => serviceApi.on<T>(panelId, event, callback),
        dispose,
    };
}
