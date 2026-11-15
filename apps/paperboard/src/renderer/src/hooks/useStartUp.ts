import { onCleanup, onMount } from "solid-js";
import { showToast } from "@mileniumhq/paperui";
import { logToMain, shellApi } from "../lib/shell";
import { setMobileMode } from "../lib/mobileMode";
import { startTarget } from "../lib/startOn";
import type { useAppSettings } from "./useAppSettings";
import type { useComputers } from "./useComputers";
import type { usePanels } from "./usePanels";
import type { useShellNavigation } from "./useShellNavigation";
import { errorMessage } from "@mileniumhq/paperapi";

export interface StartUpOptions {
    computers: ReturnType<typeof useComputers>;
    panels: ReturnType<typeof usePanels>;
    settings: ReturnType<typeof useAppSettings>;
    navigation: ReturnType<typeof useShellNavigation>;
}

// How the shell opens: the layout from the launch options, then the
// settings, computers and panels, and last where Paperboard starts.
export function useStartUp(options: StartUpOptions) {
    const { refreshComputers, activeComputerId, computersLoaded, subscribeComputerChanges } = options.computers;
    const { appSettings, loadAppSettings, applyAppSettings } = options.settings;

    onMount(async () => {
        try {
            setMobileMode((await shellApi.getLaunchOptions()).mobile);
        } catch (err) {
            logToMain("error", "Couldn't read the launch options; the layout is the desktop one until restart:", err);
            // panels follow the shell: the desktop's behavior too
            setMobileMode(false);
            showToast({
                variant: "danger",
                title: "Couldn't read how Paperboard was started",
                message: `The desktop layout shows until Paperboard restarts. ${errorMessage(err)}`,
            });
        }
    });

    const startUp = async () => {
        // Application-wide settings are read first, beside the daemon calls
        // rather than behind them, so the theme and motion are the user's
        // from the start
        const settingsLoaded = loadAppSettings();

        // Restores the active computer over privileged IPC
        await refreshComputers();

        // Data fetches are scoped per computer
        await options.panels.refreshPanelsForComputer(activeComputerId());

        // App Settings says why; until then nothing would say they're not yours
        if (!(await settingsLoaded)) {
            showToast({
                variant: "danger",
                title: "Settings not loaded",
                message: "Paperboard is showing the defaults, not your settings, and changes aren't saved. App Settings says why.",
            });
        } else {
            // the system may have changed since the last start (Run on
            // startup points at this copy of Paperboard, or macOS asks again)
            const refused = await applyAppSettings();
            if (refused) showToast({ variant: "danger", title: "Run on startup not applied", message: refused });
        }

        // Launch lands on Home or the computer App Settings starts on, never
        // on a panel: opening the last-used panel on boot made a misbehaving
        // panel the first thing the user saw, with no deliberate action to
        // blame. Home's widgets each fail inside their own tile.
        if (computersLoaded()) {
            const start = startTarget(appSettings().startOn, options.navigation.listedComputers());
            if (start.missing) {
                logToMain("error", `Paperboard starts on computer "${appSettings().startOn}", which isn't listed; opening Home.`);
                showToast({
                    variant: "warning",
                    title: "Opened Home instead",
                    message: "Paperboard is set to open on a computer that isn't listed anymore. Choose where it opens in App Settings.",
                });
            }
            if (start.computerId) options.navigation.selectRail(start.computerId);
        }
    };

    onMount(() => {
        // Subscribed before the first load, so a computer's status pushed
        // while it is read isn't missed, and torn down with the window.
        onCleanup(subscribeComputerChanges());
        void startUp();
    });
}
