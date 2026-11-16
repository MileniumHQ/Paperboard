import { createSignal } from "solid-js";
import { showError } from "@mileniumhq/paperui";
import { mobileMode } from "../lib/mobileMode";
import { shownComputers, showsWelcome } from "../lib/phoneComputers";
import { askPanelToLeave, unsavedPanels } from "../lib/unsavedPanels";
import type { useComputers } from "./useComputers";
import type { useComputerSelection } from "./useComputerSelection";
import type { usePanels } from "./usePanels";

export interface ShellNavigationOptions {
    computers: ReturnType<typeof useComputers>;
    panels: ReturnType<typeof usePanels>;
    selection: ReturnType<typeof useComputerSelection>;
    panelName: (computerId: string, panelId: string) => string;
}

// What the main area shows: Home (where Paperboard opens), App Settings, or
// the active computer's panels, and on a phone which page is slid in over
// the rail and panel list.
export function useShellNavigation(options: ShellNavigationOptions) {
    const { computers, activeComputerId, setOfflineTarget } = options.computers;
    const { setComputerTab } = options.panels;
    const selection = options.selection;

    const [railMode, setRailMode] = createSignal<"home" | "settings" | "computer">("home");
    // --mobile: the phone layout. The rail and panel list fill the screen,
    // and what's opened from them slides in over them as its own page.
    // Home and the panel frames wait for it to be known: a phone keeps its
    // own arrangement, and a frame is told it as it loads.
    const mobile = () => mobileMode() === true;
    const layoutKnown = () => mobileMode() !== null;
    const [mobilePageOpen, setMobilePageOpen] = createSignal(false);
    // the rail's Settings opens as a page over whatever the rail shows
    const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
    // a phone lists only paired computers, and opens on a welcome until one is
    const listedComputers = () => shownComputers(computers(), mobile());
    const mobileWelcome = () => showsWelcome(computers(), mobile());
    const openMobilePage = () => {
        if (mobile()) setMobilePageOpen(true);
    };

    /** the rail's value: "__home", "__settings", or a computer id */
    const railValue = () =>
        railMode() === "home" ? "__home" : railMode() === "settings" ? "__settings" : activeComputerId();

    const selectRail = (val: string) => {
        selection.supersedeSelection();
        setOfflineTarget(null);
        if (val === "__settings" && mobile()) {
            setMobileSettingsOpen(true);
            return;
        }
        setMobilePageOpen(false);
        if (val === "__home") {
            setRailMode("home");
        } else if (val === "__settings") {
            setRailMode("settings");
        } else {
            setRailMode("computer");
            void selection.selectComputer(val);
        }
    };

    /** shows a tab of a computer: a widget's "open panel", or the computer's info page */
    const openComputerTab = (compId: string, tab: string) => {
        setRailMode("computer");
        setComputerTab(compId, tab);
        openMobilePage();
        void selection.selectComputer(compId);
    };

    // A panel page holding unsaved work is shown and asked (its own dialog)
    // before the shell takes it away; false when one chose to stay.
    const mayClosePanels = async (keys: string[]): Promise<boolean> => {
        for (const key of keys) {
            if (!unsavedPanels().has(key)) continue;
            const [compId, panelId] = key.split("::");
            setRailMode("computer");
            setComputerTab(compId, panelId);
            openMobilePage();
            if (activeComputerId() !== compId) selection.showComputer(compId);
            const answer = await askPanelToLeave(key);
            if (answer.error) {
                showError(`${options.panelName(compId, panelId)} couldn't ask about its unsaved changes`, answer.error);
            }
            if (!answer.leave) return false;
        }
        return true;
    };

    return {
        railMode,
        railValue,
        mobile,
        layoutKnown,
        mobilePageOpen,
        setMobilePageOpen,
        mobileSettingsOpen,
        setMobileSettingsOpen,
        listedComputers,
        mobileWelcome,
        openMobilePage,
        selectRail,
        openComputerTab,
        mayClosePanels,
    };
}
