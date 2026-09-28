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
    // R5: the store is keyed per computer, like installed panels. A single
    // shared list let a slow computer-A registry response overwrite
    // computer-B's store while B was active — the Panel Library showed the
    // wrong machine's registry.
    const [storeByComputer, setStoreByComputer] = createSignal<
        Record<string, PanelItem[]>
    >({});
    const [storeLoadFailedByComputer, setStoreLoadFailedByComputer] =
        createSignal<Record<string, boolean>>({});
    // monotonic fetch sequence per computer: a late response from an
    // earlier fetch must not overwrite a newer one's result
    const storeFetchSeq: Record<string, number> = {};
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

    const refreshStorePanels = async (compId: string) => {
        // R5: per-computer fetch sequence — only the newest fetch for this
        // computer may write, so a slow stale response can never clobber a
        // newer one's result (the race that showed the wrong library).
        const seq = (storeFetchSeq[compId] ?? 0) + 1;
        storeFetchSeq[compId] = seq;
        try {
            const registry = await panelsApi.registry(compId);
            if (storeFetchSeq[compId] !== seq) return;
            if (Array.isArray(registry)) {
                setStoreByComputer((prev) => ({
                    ...prev,
                    [compId]: registry,
                }));
                setStoreLoadFailedByComputer((prev) => ({
                    ...prev,
                    [compId]: false,
                }));
            }
        } catch (err) {
            if (storeFetchSeq[compId] !== seq) return;
            logToMain("error", "Failed to load panel store for", compId, err);
            setStoreLoadFailedByComputer((prev) => ({
                ...prev,
                [compId]: true,
            }));
        }
    };

    const storePanelsFor = (compId: string) => storeByComputer()[compId] || [];
    const storeLoadFailedFor = (compId: string) =>
        storeLoadFailedByComputer()[compId] || false;

    const activePanelsList = (activeComputerId: string) => {
        const installed = panelsByComputer()[activeComputerId] || [];
        const installedIds = new Set(installed.map((p) => p.id));
        return storePanelsFor(activeComputerId).map((panel) => ({
            ...panel,
            isInstalled: installedIds.has(panel.id),
        }));
    };

    return {
        panelsByComputer,
        setPanelsByComputer,
        activeTabByComputer,
        setActiveTabByComputer,
        storeByComputer,
        storePanelsFor,
        storeLoadFailedFor,
        openedPanels,
        setOpenedPanels,
        reloadTokens,
        setReloadTokens,
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
