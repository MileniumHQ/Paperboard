import { blocksApi } from "./blocks";
import { getPanelId } from "./ipc";
import { STATE_EVENT, STATE_VALUE } from "./serviceCalls";
import { registerPanelHydrator } from "./panelHydration";
import { errorMessage } from "./errors";
import { problemsApi } from "./problems";

// the key of the problem a failed first read reports
const STATE_PROBLEM = "paperapi:state";

export interface PanelBridgeOptions<TState extends Record<string, any>> {
    panelId?: string;
    defaultState?: TState;
}

export function createPanelBridge<
    TState extends Record<string, any> = Record<string, any>,
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
    // whether the first read's failure is shown as the panel's problem
    let problemShown = false;

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
                if (problemShown) {
                    problemShown = false;
                    problemsApi.clear(panelId, STATE_PROBLEM);
                }
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
    // no button waits for the first read: a failure is the panel's problem,
    // shown by its name until a later read (the shell's readiness check, a
    // refresh) gets the state
    void refreshState().catch((err) => {
        // a later read that got the state already answered it
        if (appliedRead > 0) return;
        problemShown = true;
        problemsApi.report(panelId, { key: STATE_PROBLEM, title: "The panel couldn't read its service's state", message: errorMessage(err) });
    });

    const onStateChange = (
        cb: (patch: Partial<TState>, full: TState) => void,
    ): (() => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
    };

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
        dispose,
    };
}
