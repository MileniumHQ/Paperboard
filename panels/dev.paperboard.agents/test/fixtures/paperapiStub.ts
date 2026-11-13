// The SDK as the chat fixture sees it: everything real except the two things
// that need a daemon. The panel's bridge holds a settled state, and the
// actions are a service that has a conversation and nothing else, so the
// fixture decides what the chat is told and when. Any other call fails.
import { DEFAULT_STATE, UI_ACTION_IDS, type ChatEntry } from "../../src/contract";

export * from "../../../../packages/paperapi/dist/paperapi.es.js";

/** The conversation the service has: what the chat reads when it opens. */
export const conversation: ChatEntry[] = [];

const listeners = new Map<string, Set<(payload: any) => void>>();

/** The service telling every open window something happened. */
export function emit(event: string, payload: unknown): void {
    for (const cb of listeners.get(event) ?? []) cb(structuredClone(payload));
}

export const actionsApi = {
    call: async <T>(_panelId: string, id: string): Promise<T> => {
        if (id === UI_ACTION_IDS.history) return structuredClone(conversation) as T;
        if (id === UI_ACTION_IDS.pages) return [] as T;
        throw new Error(`the fixture's service has no action "${id}"`);
    },
    on: (_panelId: string, event: string, cb: (payload: any) => void): (() => void) => {
        const set = listeners.get(event) ?? new Set();
        listeners.set(event, set);
        set.add(cb);
        return () => set.delete(cb);
    },
};

export function createPanelBridge() {
    const state = { ...structuredClone(DEFAULT_STATE), settings: { name: "Fixture", harness: "claude-code" as const, model: null, compaction: "summarize" as const } };
    return {
        getState: () => state,
        refreshState: async () => state,
        onStateChange: (): (() => void) => () => {},
        dispose: () => {},
    };
}
