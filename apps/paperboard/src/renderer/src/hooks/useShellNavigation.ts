import { createEffect, createSignal, on } from "solid-js";
import { showError } from "@mileniumhq/paperui";
import { shownComputers } from "../lib/phoneComputers";
import { askPanelToLeave, unsavedPanels } from "../lib/unsavedPanels";
import type { useComputers } from "./useComputers";
import type { useComputerSelection } from "./useComputerSelection";
import type { usePanels } from "./usePanels";

export interface ShellNavigationOptions {
    computers: ReturnType<typeof useComputers>;
    panels: ReturnType<typeof usePanels>;
    selection: ReturnType<typeof useComputerSelection>;
    panelName: (computerId: string, panelId: string) => string;
    /** the host's layout (AppProps.layout); it may change while the shell runs */
    layout: () => "desktop" | "phone";
    /** the computers leave out This Computer (AppProps.hidesThisComputer) */
    hidesThisComputer: () => boolean;
}

// What the main area shows: Home (where Paperboard opens), App Settings, or
// the active computer's panels, and on a phone which page is slid in over
// the rail and panel list.
export function useShellNavigation(options: ShellNavigationOptions) {
    const { computers, activeComputerId, setOfflineTarget } = options.computers;
    const { getSelectedTab, setComputerTab } = options.panels;
    const selection = options.selection;

    const [railMode, setRailMode] = createSignal<"home" | "settings" | "computer">("home");
    // the phone layout: the rail and panel list fill the screen, and what's
    // opened from them slides in over them as its own page
    const mobile = () => options.layout() === "phone";
    const [mobilePageOpen, setMobilePageOpen] = createSignal(false);
    // the rail's Settings opens as a page over whatever the rail shows
    const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
    // the computers the shell lists
    const listedComputers = () => shownComputers(computers(), options.hidesThisComputer());
    // The layout can change under a running shell (a foldable opening or
    // closing, an iPad going split view): what was open stays open, in the
    // new layout's way. The shell never remounts, so no panel reloads.
    createEffect(on(mobile, (phone) => {
        if (phone) {
            // settings and an open panel are pages over the rail
            if (railMode() === "settings") {
                setRailMode("home");
                setMobileSettingsOpen(true);
            }
            setMobilePageOpen(railMode() === "computer" && getSelectedTab(activeComputerId()) !== "landing");
        } else {
            // beside the rail, nothing is a page
            if (mobileSettingsOpen()) setRailMode("settings");
            setMobileSettingsOpen(false);
            setMobilePageOpen(false);
        }
    }, { defer: true }));
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
        listedComputers,
        mobilePageOpen,
        setMobilePageOpen,
        mobileSettingsOpen,
        setMobileSettingsOpen,
        openMobilePage,
        selectRail,
        openComputerTab,
        mayClosePanels,
    };
}
