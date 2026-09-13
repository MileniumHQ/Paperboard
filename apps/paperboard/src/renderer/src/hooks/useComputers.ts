import { createSignal } from "solid-js";
import { computersApi, type ComputerInfo } from "../lib/shell";

// computers list + active selection
export function useComputers() {
    const [computers, setComputers] = createSignal<ComputerInfo[]>([
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

    const refreshComputers = async () => {
        try {
            const data = await computersApi.list();
            if (data && Array.isArray(data.computers)) {
                setComputers(data.computers);
                if (data.activeId) {
                    setActiveComputerId(data.activeId);
                }
                setComputersLoadFailed(false);
            }
        } catch (err) {
            console.error("[useComputers] load failed:", err);
            setComputersLoadFailed(true);
        }
    };

    const activeComputer = () =>
        computers().find((c) => c.id === activeComputerId()) || computers()[0];

    const subscribeComputerChanges = () =>
        computersApi.onChanged((data) => {
            if (data && Array.isArray(data.computers)) {
                setComputers(data.computers);
                if (data.activeId) {
                    setActiveComputerId(data.activeId);
                }
            }
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
    };
}

export type { ComputerInfo };
