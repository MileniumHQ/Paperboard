import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { computersApi, type ComputerInfo } from "../lib/shell";

// computers list + active selection
export function useComputers() {
    // Kept as a store reconciled by id: each push from main is a fresh list,
    // and replacing the array would hand every <For> new objects, so each
    // computer's sidebar, settings page, open dialogs and rail item would be
    // torn down and rebuilt on every rename, reorder or reconnect attempt.
    // Reconciled, a computer stays the same object and only what changed
    // notifies.
    const [computerList, setComputerList] = createStore<ComputerInfo[]>([
        {
            id: "local",
            name: "This Computer",
            host: "127.0.0.1",
            port: 45464,
            isLocal: true,
            // unknown until refresh probes daemon
            status: {
                connected: false,
                isRemote: false,
                host: "127.0.0.1",
                port: 45464,
            },
        },
    ]);
    const computers = () => computerList;
    /** puts the list in this order with these facts, keeping each computer's object */
    const setComputers = (list: readonly ComputerInfo[]) =>
        setComputerList(reconcile(list.map((computer) => copyOf(computer)), { key: "id" }));
    const [activeComputerId, setActiveComputerId] =
        createSignal<string>("local");
    const [offlineTarget, setOfflineTarget] =
        createSignal<ComputerInfo | null>(null);
    // R9: a failed startup load degrades the rail to "local" only, with
    // nothing telling the user why or offering a way out. A typed failed
    // flag gives App the hook for a retry affordance (same pattern the
    // panels path already has).
    const [computersLoadFailed, setComputersLoadFailed] =
        createSignal<boolean>(false);
    // the list above is a placeholder until the first load answers
    const [computersLoaded, setComputersLoaded] = createSignal<boolean>(false);

    const apply = (data: { computers: ComputerInfo[]; activeId?: string }) => {
        setComputers(data.computers);
        if (data.activeId) {
            setActiveComputerId(data.activeId);
        }
        setComputersLoadFailed(false);
        setComputersLoaded(true);
    };

    // Main pushes the whole list after every change, so the latest push is
    // always the current list. A list asked for before a push arrived may
    // answer after it (browser mode's pushes and replies travel separately),
    // and its older list must not undo what the push said.
    let pushes = 0;

    const refreshComputers = async () => {
        const pushesBefore = pushes;
        try {
            const data = await computersApi.list();
            if (pushes !== pushesBefore) return;
            if (!data || !Array.isArray(data.computers)) {
                throw new Error("Paperboard's computer list came back malformed.");
            }
            apply(data);
        } catch (err) {
            console.error("[useComputers] load failed:", err);
            if (pushes !== pushesBefore) return;
            setComputersLoadFailed(true);
        }
    };

    const activeComputer = () =>
        computers().find((c) => c.id === activeComputerId()) || computers()[0];

    const subscribeComputerChanges = () =>
        computersApi.onChanged((data) => {
            if (!data || !Array.isArray(data.computers)) {
                console.error("[useComputers] ignored a malformed computer list from main:", data);
                return;
            }
            pushes++;
            apply({ computers: data.computers, activeId: data.activeId });
        });

    return {
        computers,
        setComputers,
        activeComputerId,
        setActiveComputerId,
        offlineTarget,
        setOfflineTarget,
        refreshComputers,
        activeComputer,
        subscribeComputerChanges,
        computersLoadFailed,
        computersLoaded,
    };
}

// the store keeps the objects it is given, so it gets its own copies: a
// list from IPC is fresh, but one put back from the store's own entries
// (a reorder) must not be reconciled into itself
function copyOf(computer: ComputerInfo): ComputerInfo {
    return { ...computer, status: { ...computer.status } };
}

export type { ComputerInfo };
