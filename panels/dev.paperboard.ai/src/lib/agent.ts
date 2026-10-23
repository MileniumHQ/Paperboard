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
    type BrainModel,
    type ChatEntry,
    type ComputerBudget,
    type ComputerWindow,
    type Harness,
    type HarnessInfo,
    type InputEvent,
    type MemoryFact,
    type MemoryList,
    type MemoryNoteInfo,
    type Routine,
    type Settings,
    type WindowFrame,
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

    // someone started over (here or in another window)
    const offCleared = actionsApi.on(PANEL_ID, EVENTS.cleared, () => setEntries([]));

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
        models: (harness: Harness) => call<{ models: BrainModel[] }>(UI_ACTION_IDS.models, { harness }).then((r) => r.models),
        setup: (settings: Settings) => call(UI_ACTION_IDS.setup, { settings }),
        installComputer: (budget: ComputerBudget) => call(UI_ACTION_IDS.installComputer, { budget }),
        startComputer: () => call(UI_ACTION_IDS.startComputer),
        stopComputer: () => call(UI_ACTION_IDS.stopComputer),
        send: (text: string, replyTo?: string) => call<{ id: string; waiting: boolean }>(UI_ACTION_IDS.send, { text, replyTo }),
        unqueue: (id: string) => call(UI_ACTION_IDS.unqueue, { id }),
        sendNow: () => call(UI_ACTION_IDS.sendNow),
        startOver: () => call(UI_ACTION_IDS.startOver),
        setMemory: (memoryGb: number) => call(UI_ACTION_IDS.setMemory, { memoryGb }),
        memory: () => call<MemoryList>(UI_ACTION_IDS.memory),
        deleteFact: (id: string) => call(UI_ACTION_IDS.deleteFact, { id }),
        readNote: (key: string) => call<{ key: string; when: string; body: string }>(UI_ACTION_IDS.readNote, { key }),
        deleteNote: (key: string) => call(UI_ACTION_IDS.deleteNote, { key }),
        routines: () => call<Routine[]>(UI_ACTION_IDS.routines),
        deleteRoutine: (id: string) => call(UI_ACTION_IDS.deleteRoutine, { id }),
        signInShot: (id: string) => call<{ image: string }>(UI_ACTION_IDS.signInShot, { id }),
        signIn: (id: string, values: string[]) => call(UI_ACTION_IDS.signIn, { id, values }),
        declineSignIn: (id: string) => call(UI_ACTION_IDS.declineSignIn, { id }),
        windows: () => call<{ windows: ComputerWindow[] }>(UI_ACTION_IDS.windows).then((r) => r.windows),
        frame: (window: number, since: string | null) => call<WindowFrame>(UI_ACTION_IDS.frame, { window, since: since ?? undefined }),
        input: (window: number, events: InputEvent[]) => call(UI_ACTION_IDS.input, { window, events }),
        closeWindow: (window: number) => call(UI_ACTION_IDS.closeWindow, { window }),
        control: (take: boolean) => call<{ userControl: boolean }>(UI_ACTION_IDS.control, { take }),
        dispose: () => {
            offState();
            offEntry();
            offCleared();
            bridge.dispose();
        },
    };
}

export type Agent = ReturnType<typeof createAgent>;
