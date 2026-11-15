import { batch, createMemo, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { panelsApi, type InvalidPanel, type PanelItem, errorMessage } from "@mileniumhq/paperapi";
import { logToMain } from "../lib/shell";
import { isShellTab } from "../lib/shellTabs";
import { unsavedPanels } from "../lib/unsavedPanels";

// every opened key is walked by PanelView's frame bookkeeping and LRU, so
// the list is bounded: past the cap the oldest is dropped, and reopening it
// adds it again. Never dropped: a panel some computer shows (switching back
// to that computer shows it without selecting it again, so it would be an
// empty area with no frame), nor one whose page holds unsaved work.
export const MAX_OPENED_PANELS = 50;

// panel state per computer
export function usePanels() {
    // Reconciled by panel id, like the computers: a refresh lists every
    // panel afresh, and new objects would remount each sidebar row, widget
    // source and gallery card (reloading previews, dropping chosen sizes).
    // A panel stays the same object and only what changed notifies.
    const [panelStore, setPanelStore] = createStore<Record<string, PanelItem[]>>({});
    const panelsByComputer = () => panelStore;
    // installed panels whose manifest the computer refuses, with why
    const [invalidStore, setInvalidStore] = createStore<Record<string, InvalidPanel[]>>({});
    const invalidPanelsByComputer = () => invalidStore;
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
    /** a forgotten computer's panels are gone with it: their lists, frames and tab */
    const forgetPanels = (compId: string) =>
        batch(() => {
            setPanelStore(produce((panels) => {
                delete panels[compId];
            }));
            setInvalidStore(produce((invalid) => {
                delete invalid[compId];
            }));
            setOpenedPanels((prev) => prev.filter((k) => !k.startsWith(`${compId}::`)));
            setActiveTabByComputer((prev) => {
                const copy = { ...prev };
                delete copy[compId];
                return copy;
            });
        });
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
                const kept = new Set(unsavedPanels());
                for (const [id, shown] of Object.entries(activeTabByComputer())) kept.add(`${id}::${shown}`);
                const drop = next.findIndex((k) => !kept.has(k));
                if (drop !== -1) next.splice(drop, 1);
                return next;
            });
        }
    };

    // Fetches name their computer explicitly. Many things refresh a
    // computer's list at once (an uninstall, an update, a reconnect, Home):
    // only the newest request's answer lands, so an older list answering
    // last can't bring back a panel that is gone.
    const latestRequest: Record<string, number> = {};
    const refreshPanelsForComputer = async (compId: string) => {
        const request = (latestRequest[compId] = (latestRequest[compId] ?? 0) + 1);
        try {
            const { panels, invalid } = await panelsApi.listInstalled(compId);
            if (latestRequest[compId] !== request) return;
            batch(() => {
                setPanelStore(compId, reconcile(panels, { key: "id" }));
                setInvalidStore(compId, reconcile(invalid, { key: "id" }));
                setPanelsLoadError((prev) => (prev[compId] === "" ? prev : { ...prev, [compId]: "" }));
            });
        } catch (err) {
            logToMain("error", "Failed to load installed panels for", compId, err);
            if (latestRequest[compId] !== request) return;
            setPanelsLoadError((prev) => ({ ...prev, [compId]: errorMessage(err) }));
        }
    };

    return {
        panelsByComputer,
        invalidPanelsByComputer,
        forgetPanels,
        activeTabByComputer,
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
