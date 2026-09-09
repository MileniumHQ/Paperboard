import { createSignal } from "solid-js";
import { panelsApi, config, type PanelItem } from "@paperboard-dev/paperapi";
import { logToMain } from "../lib/shell";

// last opened local panel, persisted across launches
export const LAST_OPENED_ID = "shell-last-opened";

// panel state per computer
export function usePanels() {
    const [panelsByComputer, setPanelsByComputer] = createSignal<
        Record<string, PanelItem[]>
    >({});
    const [activeTabByComputer, setActiveTabByComputer] = createSignal<
        Record<string, string>
    >({
        local: "landing",
    });
    const [storePanels, setStorePanels] = createSignal<PanelItem[]>([]);
    const [openedPanels, setOpenedPanels] = createSignal<string[]>([]);
    const [reloadTokens, setReloadTokens] = createSignal<
        Record<string, number>
    >({});
    const [storeLoadFailed, setStoreLoadFailed] =
        createSignal<boolean>(false);
    // failed refresh keeps prior list and flags retry
    const [panelsLoadFailed, setPanelsLoadFailed] = createSignal<
        Record<string, boolean>
    >({});

    const getSelectedTab = (compId: string) => {
        return activeTabByComputer()[compId] || "landing";
    };

    const setComputerTab = (compId: string, tab: string) => {
        setActiveTabByComputer((prev) => ({
            ...prev,
            [compId]: tab,
        }));
        if (tab !== "landing" && tab !== "library" && tab !== "settings") {
            const key = `${compId}::${tab}`;
            setOpenedPanels((prev) =>
                prev.includes(key) ? prev : [...prev, key],
            );
            if (compId === "local") {
                config
                    .set({ panelId: tab }, LAST_OPENED_ID)
                    .catch(() => {});
            }
        }
    };

    // fetches name their computer explicitly
    const refreshPanelsForComputer = async (compId: string) => {
        try {
            const installed = await panelsApi.list(compId);
            if (Array.isArray(installed)) {
                setPanelsByComputer((prev) => ({
                    ...prev,
                    [compId]: installed,
                }));
                setPanelsLoadFailed((prev) => ({ ...prev, [compId]: false }));
            }
        } catch (err) {
            logToMain("error", "Failed to load installed panels for", compId, err);
            setPanelsLoadFailed((prev) => ({ ...prev, [compId]: true }));
        }
    };

    const refreshStorePanels = async (compId: string) => {
        try {
            const registry = await panelsApi.registry(compId);
            if (Array.isArray(registry)) {
                setStorePanels(registry);
                setStoreLoadFailed(false);
            }
        } catch (err) {
            logToMain("error", "Failed to load panel store:", err);
            setStoreLoadFailed(true);
        }
    };

    const activePanelsList = (activeComputerId: string) => {
        const installed = panelsByComputer()[activeComputerId] || [];
        const installedIds = new Set(installed.map((p) => p.id));
        return storePanels().map((panel) => ({
            ...panel,
            isInstalled: installedIds.has(panel.id),
        }));
    };

    return {
        panelsByComputer,
        setPanelsByComputer,
        activeTabByComputer,
        setActiveTabByComputer,
        storePanels,
        setStorePanels,
        openedPanels,
        setOpenedPanels,
        reloadTokens,
        setReloadTokens,
        storeLoadFailed,
        setStoreLoadFailed,
        panelsLoadFailed,
        setPanelsLoadFailed,
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
        refreshStorePanels,
        activePanelsList,
    };
}

export type { PanelItem };
