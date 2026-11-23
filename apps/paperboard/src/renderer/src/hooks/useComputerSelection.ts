import { createEffect, createSignal, on } from "solid-js";
import { computersApi, logToMain } from "../lib/shell";
import { START_ON_HOME } from "../lib/startOn";
import type { AppSettingsData } from "../lib/appSettings";
import type { useComputers } from "./useComputers";
import type { usePanels } from "./usePanels";
import { errorMessage } from "@mileniumhq/paperapi";
import { createLatest } from "@mileniumhq/paperui";

export interface ComputerSelectionOptions {
    computers: ReturnType<typeof useComputers>;
    panels: ReturnType<typeof usePanels>;
    appSettings: () => AppSettingsData;
    onAppSettingsChange: (settings: AppSettingsData) => Promise<void>;
}

// Which computer the shell is on: switching to one (a remote is probed
// first, and an offline one asks what to do), listing its panels, and
// letting go of one that is forgotten.
export function useComputerSelection(options: ComputerSelectionOptions) {
    const { computers, setActiveComputerId, activeComputerId, setOfflineTarget, refreshComputers } = options.computers;
    const { activeTabByComputer, openedPanels, setComputerTab, refreshPanelsForComputer, panelsLoadFailed, forgetPanels } = options.panels;

    // a newer selection wins: a slow probe for an older one is dropped
    const selection = createLatest();
    /** an older selection still probing is dropped */
    const supersedeSelection = selection.cancel;

    // why a computer couldn't be made the active one: a toast, and its panel list says "Couldn't load"
    const [switchError, setSwitchError] = createSignal<Record<string, string>>({});
    // makes the computer the one main talks to and Paperboard reopens, then
    // lists its panels
    const connectComputer = async (compId: string) => {
        setSwitchError((prev) => ({ ...prev, [compId]: "" }));
        try {
            if (!(await computersApi.switch(compId))) throw new Error("Paperboard doesn't know this computer anymore.");
        } catch (err) {
            logToMain("error", "Failed to switch computer:", err);
            setSwitchError((prev) => ({ ...prev, [compId]: errorMessage(err) }));
            return;
        }
        await refreshPanelsForComputer(compId);
    };

    /** shows the computer, on the tab it was left on, without probing it */
    const showComputer = (compId: string) => {
        setActiveComputerId(compId);

        if (!activeTabByComputer()[compId]) {
            const openForComp = openedPanels().filter((key) => key.startsWith(`${compId}::`));
            if (openForComp.length === 0) {
                setComputerTab(compId, "landing");
            } else {
                const [, fallbackPanel] = openForComp[openForComp.length - 1].split("::");
                setComputerTab(compId, fallbackPanel);
            }
        }

        void connectComputer(compId);
    };

    const selectComputer = async (compId: string) => {
        const current = selection();
        const comp = computers().find((c) => c.id === compId);
        if (!comp || comp.isLocal) {
            showComputer(compId);
            return;
        }

        // Probe before switching so offline computers prompt explicitly; the
        // dialog shows this probe's answer and probes again only when asked
        let unreachable: { error?: string } | null = null;
        try {
            const probe = await computersApi.reach(comp.id);
            if (!probe?.reachable) unreachable = { error: probe?.error };
        } catch (err) {
            logToMain("error", "Failed to probe computer:", err);
            unreachable = { error: errorMessage(err) };
        }
        if (!current()) return;
        if (unreachable) {
            setOfflineTarget({ ...comp, status: { ...comp.status, connected: false, error: unreachable.error } });
            return;
        }

        showComputer(compId);
    };

    // a computer a dialog found answering again: the one way back to it,
    // switching to it and listing its panels (connectComputer)
    const reconnected = async (compId: string) => {
        await refreshComputers();
        showComputer(compId);
    };

    const addComputer = async (newComp: { id: string }) => {
        await refreshComputers();
        await selectComputer(newComp.id);
    };

    // a failed forget rejects with why, and a computer that couldn't be told
    // answers why; the dialog stays open showing either
    const forgetComputer = async (compId: string, evenIfUntold: boolean): Promise<string | null> => {
        const untold = await computersApi.remove(compId, evenIfUntold);
        if (untold !== null) return untold;
        forgetPanels(compId);
        await refreshComputers();
        // forgetting another computer leaves you where you are
        if (activeComputerId() === compId) await selectComputer("local");
        // Paperboard can't open on a computer it forgot
        if (options.appSettings().startOn === compId) {
            await options.onAppSettingsChange({ ...options.appSettings(), startOn: START_ON_HOME });
        }
        return null;
    };

    // a panel list that failed is fetched again once its computer reconnects;
    // tracks the computer and its connection, not the list it fetches
    const wasConnected: Record<string, boolean | undefined> = {};
    createEffect(on(
        [activeComputerId, () => computers().find((c) => c.id === activeComputerId())?.status?.connected === true],
        ([id, connected]) => {
            const was = wasConnected[id];
            wasConnected[id] = connected;
            if (was === false && connected && panelsLoadFailed()[id]) {
                void refreshPanelsForComputer(id);
            }
        },
    ));

    return { supersedeSelection, selectComputer, showComputer, connectComputer, switchError, reconnected, addComputer, forgetComputer };
}
