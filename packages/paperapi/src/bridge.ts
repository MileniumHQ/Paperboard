import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import { STATE_EVENT, STATE_VALUE, serviceApi } from "./serviceCalls";
import { registerPanelHydrator } from "./panelHydration";
import { errorMessage } from "./errors";

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
    // late answers lose: each read is numbered, an answer older than one
    // already applied is dropped, and a field a patch changed while a read
    // was out keeps the patch's value, which is newer than the read's
    let latestRead = 0;
    let appliedRead = 0;
    const patchedDuring = new Map<number, Set<string>>();

    // the subscription is tearable: createPanelBridge returns dispose()
    const unsubscribeSync = blocksApi.onEvent(panelId, STATE_EVENT, (payload: any) => {
        if (payload?.state) {
            for (const keys of patchedDuring.values()) for (const key of Object.keys(payload.state)) keys.add(key);
            localState = { ...localState, ...payload.state };
            for (const cb of listeners) {
                cb(payload.state, localState);
            }
        }
    });

    const refreshState = async (): Promise<TState> => {
        const read = ++latestRead;
        const patched = new Set<string>();
        patchedDuring.set(read, patched);
        try {
            const fetched = await blocksApi.read<TState>(panelId, STATE_VALUE);
            if (fetched && typeof fetched === "object" && read > appliedRead) {
                appliedRead = read;
                status = { ready: true };
                const fresh = Object.fromEntries(Object.entries(fetched).filter(([key]) => !patched.has(key))) as Partial<TState>;
                localState = { ...localState, ...fresh };
                for (const cb of listeners) {
                    cb(fresh, localState);
                }
            }
        } catch (err) {
            // the caller hears it; the bridge keeps serving the last-known
            // (possibly default) state meanwhile
            if (read === latestRead) status = { ready: false, error: errorMessage(err) };
            throw err;
        } finally {
            patchedDuring.delete(read);
        }
        return localState;
    };

    const unregisterHydrator = registerPanelHydrator(panelId, refreshState);
    // quiet: refreshState already put the failure in the bridge's status, which the page shows
    void refreshState().catch((err) => console.error(`[bridge:${panelId}] initial hydration failed; retry via refreshState:`, err));

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

    // teardown for the whole bridge: a bridge that outlives its component
    // must not keep its transport subscription or listeners alive
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
