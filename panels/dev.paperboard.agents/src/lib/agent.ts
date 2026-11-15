// The UI's one line to the service: the panel's contract client, its
// mirrored state, and the conversation's entries. Nothing here decides
// anything; the service owns the agent, its computer and the conversation,
// so every open window agrees.

import { errorMessage, serviceClient } from "@mileniumhq/paperapi";
import { createLatest } from "@mileniumhq/paperui";
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createFiles } from "./files";
import { createSettingsQueue } from "./settingsQueue";
import { DEFAULT_STATE, LIMITS, agentsContract, type AiState, type ChatEntry } from "../contract";

type Hydration = "loading" | "ready" | "failed";

export function createAgent() {
    const client = serviceClient(agentsContract);
    const { calls, events } = client;
    const mirror = client.state;
    const [state, setState] = createStore<AiState>(structuredClone(DEFAULT_STATE));
    const [entries, setEntries] = createStore<ChatEntry[]>([]);
    const [hydration, setHydration] = createSignal<Hydration>("loading");
    const [error, setError] = createSignal<string | null>(null);

    const offState = mirror.subscribe((full) => setState(reconcile(full)));
    // an entry is whole every time: add it, or replace the copy we have
    const offEntry = events.entry((entry) => {
        const i = entries.findIndex((e) => e.id === entry.id);
        if (i >= 0) setEntries(i, reconcile(entry));
        else setEntries(entries.length, entry);
    });

    // someone started over (here or in another window)
    const offCleared = events.cleared(() => {
        setEntries([]);
        files.clear();
    });
    // another conversation is current now (here or in another window): its history replaces what's shown
    const offSwitched = events.switched(() => {
        setEntries([]);
        files.clear();
        void load(false);
    });

    const files = createFiles(calls);

    // a switch or a retry starts a newer read: an older one's answer (another conversation's history, maybe) is dropped
    const latest = createLatest();
    /**
     * The state (when asked) and then the current conversation so far; entries that arrived as events
     * while it was on its way are kept. Failure is shown, with a way to retry.
     */
    const load = async (withState: boolean) => {
        const current = latest();
        try {
            if (withState) {
                const full = await mirror.refresh();
                if (current()) setState(reconcile(full));
            }
            const history = await calls.history({ limit: LIMITS.history });
            if (!current()) return;
            const known = new Set(history.map((e) => e.id));
            setEntries(reconcile([...history, ...entries.filter((e) => !known.has(e.id))]));
            setHydration("ready");
        } catch (e) {
            if (!current()) return;
            setError(errorMessage(e));
            setHydration("failed");
        }
    };

    /** Hydrate (again): state, then the conversation so far. */
    const hydrate = () => {
        setHydration("loading");
        setError(null);
        return load(true);
    };
    void hydrate();

    /** every change to the settings goes through here, one at a time, each built from the settings as they then stand */
    const saveSettings = createSettingsQueue({
        current: () => state.settings,
        write: (settings) => calls.setup({ settings }),
        refresh: async () => setState(reconcile(await mirror.refresh())),
    });

    return {
        state,
        /** what the person named their agent; every view that shows it waits for the settings, which name it */
        name: () => state.settings?.name ?? "Your agent",
        entries,
        hydration,
        error,
        hydrate,
        /** everything the page asks the service, as the contract says it */
        calls,
        /** what the service tells every open window */
        events,
        saveSettings,
        files,
        dispose: () => {
            offState();
            offEntry();
            offCleared();
            offSwitched();
            files.clear();
            mirror.dispose();
        },
    };
}

export type Agent = ReturnType<typeof createAgent>;
