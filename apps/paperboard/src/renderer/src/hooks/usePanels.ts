import { createSignal } from "solid-js";
import { panelsApi, type PanelItem } from "@paperboard-dev/paperapi";
import { logToMain } from "../lib/shell";

// placeholder divs render per opened key (PanelView), so the list itself
// must be bounded: most-recent-first, oldest dropped past the cap.
// Reopening a dropped key re-adds it — nothing is lost but dead divs.
export const MAX_OPENED_PANELS = 50;

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
    const [openedPanels, setOpenedPanels] = createSignal<string[]>([]);
    const [reloadTokens, setReloadTokens] = createSignal<
        Record<string, number>
    >({});
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
            setOpenedPanels((prev) => {
                const next = [...prev.filter((k) => k !== key), key];
                return next.length > MAX_OPENED_PANELS
                    ? next.slice(next.length - MAX_OPENED_PANELS)
                    : next;
            });
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

    return {
        panelsByComputer,
        setPanelsByComputer,
        activeTabByComputer,
        setActiveTabByComputer,
        openedPanels,
        setOpenedPanels,
        reloadTokens,
        setReloadTokens,
        panelsLoadFailed,
        setPanelsLoadFailed,
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
    };
}

export type { PanelItem };
