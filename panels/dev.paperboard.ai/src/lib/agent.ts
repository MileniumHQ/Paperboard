// The UI's one line to the service: synced state, the conversation's
// entries, and the actions. Nothing here decides anything; the service owns
// the agent, its computer and the conversation, so every open window agrees.

import { actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import {
    DEFAULT_STATE,
    EVENTS,
    LIMITS,
    PANEL_ID,
    UI_ACTION_IDS,
    type AiState,
    type ChatEntry,
    type ComputerBudget,
    type HarnessInfo,
    type Settings,
} from "../contract";

export type Hydration = "loading" | "ready" | "failed";

export function createAgent() {
    const bridge = createPanelBridge<AiState>({ panelId: PANEL_ID, defaultState: DEFAULT_STATE });
    const [state, setState] = createStore<AiState>(structuredClone(DEFAULT_STATE));
    const [entries, setEntries] = createStore<ChatEntry[]>([]);
    const [hydration, setHydration] = createSignal<Hydration>("loading");
    const [error, setError] = createSignal<string | null>(null);

    const offState = bridge.onStateChange((_patch, full) => setState(reconcile(full)));
    // an entry is whole every time: add it, or replace the copy we have
    const offEntry = actionsApi.on(PANEL_ID, EVENTS.entry, (entry: ChatEntry) => {
        const i = entries.findIndex((e) => e.id === entry.id);
        if (i >= 0) setEntries(i, reconcile(entry));
        else setEntries(entries.length, entry);
    });

    const call = <T>(id: string, inputs: Record<string, unknown> = {}) => actionsApi.call<T>(PANEL_ID, id, inputs);

    /** Hydrate (again): state, then the conversation so far. Failure is shown, with a way to retry. */
    const hydrate = async () => {
        setHydration("loading");
        setError(null);
        try {
            setState(reconcile(await bridge.refreshState()));
            const history = await call<ChatEntry[]>(UI_ACTION_IDS.history, { limit: LIMITS.history });
            // entries that arrived as events while history was on its way are kept
            const known = new Set(history.map((e) => e.id));
            setEntries(reconcile([...history, ...entries.filter((e) => !known.has(e.id))]));
            setHydration("ready");
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setHydration("failed");
        }
    };
    void hydrate();

    return {
        state,
        entries,
        hydration,
        error,
        hydrate,
        detect: () => call<HarnessInfo[]>(UI_ACTION_IDS.detect),
        setup: (settings: Settings) => call(UI_ACTION_IDS.setup, { settings }),
        installComputer: (budget: ComputerBudget) => call(UI_ACTION_IDS.installComputer, { budget }),
        startComputer: () => call(UI_ACTION_IDS.startComputer),
        stopComputer: () => call(UI_ACTION_IDS.stopComputer),
        send: (text: string) => call<ChatEntry>(UI_ACTION_IDS.send, { text }),
        stop: () => call(UI_ACTION_IDS.stop),
        dispose: () => {
            offState();
            offEntry();
            bridge.dispose();
        },
    };
}

export type Agent = ReturnType<typeof createAgent>;
