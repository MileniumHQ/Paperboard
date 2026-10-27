import { createMemo, createSignal } from "solid-js";
import { panelsApi, type PanelItem } from "@mileniumhq/paperapi";
import { logToMain } from "../lib/shell";
import { isShellTab } from "../lib/shellTabs";

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
    // a failed refresh keeps the prior list and holds why it failed, for a retry
    const [panelsLoadError, setPanelsLoadError] = createSignal<
        Record<string, string>
    >({});
    const panelsLoadFailed = createMemo(() =>
        Object.fromEntries(Object.entries(panelsLoadError()).map(([id, error]) => [id, error !== ""])),
    );

    const getSelectedTab = (compId: string) => {
        return activeTabByComputer()[compId] || "landing";
    };

    const setComputerTab = (compId: string, tab: string) => {
        setActiveTabByComputer((prev) => ({
            ...prev,
            [compId]: tab,
        }));
        if (!isShellTab(tab)) {
            const key = `${compId}::${tab}`;
            setOpenedPanels((prev) => {
                // Selecting an already-open panel must NOT rebuild the list:
                // a new array reorders the keys, which makes PanelView's
                // <For> move live iframes in the DOM, and detaching/reinserting
                // an iframe flickers its contents. Membership only.
                if (prev.includes(key)) return prev;
                const next = [...prev, key];
                if (next.length <= MAX_OPENED_PANELS) return next;
                // drop the oldest placeholder, never the panel just selected
                const drop = next.findIndex((k) => k !== key);
                next.splice(drop, 1);
                return next;
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
                setPanelsLoadError((prev) => ({ ...prev, [compId]: "" }));
            }
        } catch (err) {
            logToMain("error", "Failed to load installed panels for", compId, err);
            setPanelsLoadError((prev) => ({ ...prev, [compId]: err instanceof Error ? err.message : String(err) }));
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
        panelsLoadError,
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
    };
}

export type { PanelItem };
