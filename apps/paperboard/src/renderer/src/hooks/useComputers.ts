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

    const refreshComputers = async () => {
        try {
            const data = await computersApi.list();
            if (data && Array.isArray(data.computers)) {
                setComputers(data.computers);
                if (data.activeId) {
                    setActiveComputerId(data.activeId);
                }
            }
        } catch {}
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
    };
}

export type { ComputerInfo };
