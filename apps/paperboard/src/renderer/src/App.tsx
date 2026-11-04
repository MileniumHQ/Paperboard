import { type Component, type JSX, batch, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import {
    PaperProvider,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperButton,
    PaperQuote,
    PaperText,
    useContextMenuState,
    getVarCss,
    PaperSlidePage,
} from "@mileniumhq/paperui";
import {
    loadInstalledPanelMedia,
    panelsApi,
    type PanelItem,
} from "@mileniumhq/paperapi";
import {
    computersApi,
    isBrowserShell,
    logToMain,
    shellApi,
    panelUrl,
    readPanelListingFile,
    type ComputerInfo as ComputerItem,
} from "./lib/shell";
import type { LaunchOptions } from "../../shared/launchOptions";
import AppSettings from "./components/settings/AppSettings";
import PanelPermissionPrompt from "./components/panels/PanelPermissionPrompt";
import PanelView from "./components/panels/PanelView";
import LibraryFrame from "./components/panels/LibraryFrame";
import PanelContextMenu from "./components/panels/PanelContextMenu";
import TutorialDialog, { type OpenTutorial } from "./components/layout/TutorialDialog";
import { APP_TUTORIAL } from "./lib/appTutorial";
import { type SeenTutorials, loadSeenTutorials, markTutorialSeen, withSeen } from "./lib/panelTutorials";
import LibraryContextMenu from "./components/panels/LibraryContextMenu";
import type { RestartState } from "./components/panels/PanelView";
import UninstallPanelModal, {
    type UninstallTarget,
} from "./components/panels/UninstallPanelModal";
import LandingView from "./components/computer/LandingView";
import ComputerSetupWizard from "./components/wizard/ComputerSetupWizard";
import ComputerHeader from "./components/computer/ComputerHeader";
import ComputerSettings from "./components/computer/ComputerSettings";
import { isShellTab } from "./lib/shellTabs";
import { createShownWhileClosing } from "./lib/openings";
import ConnectionLostOverlay from "./components/computer/ConnectionLostOverlay";
import OfflineComputerModal from "./components/computer/OfflineComputerModal";
import ComputerRail from "./components/computer/ComputerRail";
import ComputerContextMenu from "./components/computer/ComputerContextMenu";
import HomeView from "./components/home/HomeView";
import AppUpdateModal from "./components/layout/AppUpdateModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { usePackageUpdates } from "./hooks/usePackageUpdates";
import PackageUpdateModal from "./components/layout/PackageUpdateModal";
import TopBar from "./components/layout/TopBar";
import { computerIcon } from "./components/computer/computerIcon";
import MobileWelcome from "./components/computer/MobileWelcome";
import { shownComputers, showsWelcome } from "./lib/phoneComputers";
import libraryIcon from "./assets/PanelLibrary.png";
import styles from "./App.module.css";
import iconStyles from "./components/computer/panelIcon.module.css";
import { useAppSettings } from "./hooks/useAppSettings";
import { START_ON_HOME, startTarget } from "./lib/startOn";
import { useComputers } from "./hooks/useComputers";
import { usePanels } from "./hooks/usePanels";

export type { ComputerItem };
const App: Component = () => {
    const appUpdate = useAppUpdate();
    const packageUpdates = usePackageUpdates();
    const {
        computers,
        activeComputerId,
        setActiveComputerId,
        offlineTarget,
        setOfflineTarget,
        refreshComputers,
        activeComputer,
        subscribeComputerChanges,
        computersLoadFailed,
        computersLoaded,
    } = useComputers();
    const {
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
    } = usePanels();
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
    // the wizard stays through the fade and starts over on the next open
    const setupShown = createShownWhileClosing(isSetupOpen);
    // which first-open tutorials were shown; null until the record loads,
    // and it stays null if it can't be read or --no-tutorial is set, so
    // nothing opens by itself (an unreadable record never replays them all)
    const [seenTutorials, setSeenTutorials] = createSignal<SeenTutorials | null>(null);
    const [openTutorial, setOpenTutorial] = createSignal<"app" | { compId: string; panel: PanelItem } | null>(null);
    const panelContextMenu = useContextMenuState();
    const [contextMenuPanel, setContextMenuPanel] = createSignal<{
        compId: string;
        panel: PanelItem;
    } | null>(null);
    const computerContextMenu = useContextMenuState();
    const [contextMenuComputerId, setContextMenuComputerId] = createSignal<string | null>(null);
    const libraryContextMenu = useContextMenuState();
    const [libraryReloadToken, setLibraryReloadToken] = createSignal(0);
    const reloadLibrary = () =>
        setLibraryReloadToken((token) => token + 1);
    const [isForgetConfirmOpen, setIsForgetConfirmOpen] = createSignal(false);
    const [isForgetting, setIsForgetting] = createSignal(false);
    const [forgetError, setForgetError] = createSignal<string | null>(null);
    const [isUninstallModalOpen, setIsUninstallModalOpen] =
        createSignal<boolean>(false);
    const [uninstallTarget, setUninstallTarget] =
        createSignal<UninstallTarget | null>(null);
    const [isUninstalling, setIsUninstalling] = createSignal<boolean>(false);
    const [uninstallDeleteData, setUninstallDeleteData] =
        createSignal<boolean>(false);
    const [uninstallError, setUninstallError] = createSignal<string | null>(
        null,
    );
    const {
        appSettings,
        loadAppSettings,
        handleAppSettingsChange,
        settingsFailure,
        retryLoadAppSettings,
        dismissSettingsFailure,
    } = useAppSettings();
    // what the main area shows: Home (where Paperboard opens), app
    // settings, or the active computer's panels
    const [railMode, setRailMode] = createSignal<"home" | "settings" | "computer">("home");
    const showAppSettings = () => railMode() === "settings";
    // --mobile: the phone layout. The rail and panel list fill the screen,
    // and what's opened from them slides in over them as its own page.
    const [mobile, setMobile] = createSignal(false);
    // Home waits for the layout to be known: a phone keeps its own arrangement
    const [layoutKnown, setLayoutKnown] = createSignal(false);
    const [mobilePageOpen, setMobilePageOpen] = createSignal(false);
    // the rail's Settings opens as a page over whatever the rail shows
    const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
    // a phone lists only paired computers, and opens on a welcome until one is
    const listedComputers = () => shownComputers(computers(), mobile());
    const mobileWelcome = () => showsWelcome(computers(), mobile());
    const openMobilePage = () => {
        if (mobile()) setMobilePageOpen(true);
    };

    const handleRailSelect = (val: string) => {
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
            handleComputerSelect(val);
        }
    };

    // a widget's "open panel": the panel's own computer, its own tab
    const openPanelFromHome = (compId: string, panelId: string) => {
        setRailMode("computer");
        setComputerTab(compId, panelId);
        openMobilePage();
        void handleComputerSelect(compId);
    };

    // the ONLY reload path: PanelView builds the iframe src from this
    // token (`?_r=`), so bumping it reloads through Solid instead of a
    // direct DOM mutation that bypasses the framework
    const bumpReloadToken = (key: string) => {
        setReloadTokens((prev) => ({
            ...prev,
            [key]: (prev[key] || 0) + 1,
        }));
    };

    // per-panel restart progress, shown inside the panel's own frame
    const [restartStates, setRestartStates] = createSignal<Record<string, RestartState>>({});
    const setRestartState = (key: string, state: RestartState | null) =>
        setRestartStates((prev) => {
            const next = { ...prev };
            if (state) next[key] = state;
            else delete next[key];
            return next;
        });

    const restartPanel = async (compId: string, panelId: string, name: string) => {
        const key = `${compId}::${panelId}`;
        if (restartStates()[key]?.kind === "restarting") return;
        setComputerTab(compId, panelId);
        setRestartState(key, { kind: "restarting" });
        try {
            // false = no service declared; reloading the view is the restart
            await panelsApi.restartService(panelId, compId);
            setRestartState(key, null);
            bumpReloadToken(key);
        } catch (err: any) {
            logToMain("error", "Failed to restart panel:", err);
            setRestartState(key, {
                kind: "failed",
                message: `Couldn't restart ${name}${err?.message ? `: ${err.message}` : ""}`,
            });
        }
    };

    const handleRestartPanel = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        void restartPanel(target.compId, target.panel.id, target.panel.name);
    };

    const handleRequestUninstall = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        setUninstallTarget(target);
        setUninstallDeleteData(false);
        setIsUninstallModalOpen(true);
    };

    const handleConfirmUninstall = async () => {
        const target = uninstallTarget();
        if (!target || isUninstalling()) return;
        setIsUninstalling(true);
        setUninstallError(null);
        try {
            await panelsApi.uninstall(target.panel.id, target.compId, {
                deleteData: uninstallDeleteData(),
            });
            const key = `${target.compId}::${target.panel.id}`;
            setOpenedPanels((prev) => prev.filter((k) => k !== key));
            setRestartState(key, null);
            if (getSelectedTab(target.compId) === target.panel.id) {
                setComputerTab(target.compId, "landing");
                // the phone layout's landing is the panel list underneath
                setMobilePageOpen(false);
            }
            await refreshPanelsForComputer(target.compId);
            setIsUninstallModalOpen(false);
            setUninstallTarget(null);
            setUninstallDeleteData(false);
        } catch (err: any) {
            logToMain("error", "Failed to uninstall panel:", err);
            setUninstallError(
                `Couldn't uninstall ${target.panel.name}${err?.message ? `: ${err.message}` : ""}`,
            );
        } finally {
            setIsUninstalling(false);
        }
    };

    const handleReconnectSuccess = async () => {
        const compId = activeComputerId();
        await refreshComputers();
        await refreshPanelsForComputer(compId);
    };

    // re-fetch failed panel list on reconnect
    const wasConnected: Record<string, boolean | undefined> = {};
    createEffect(() => {
        const id = activeComputerId();
        const comp = computers().find((c) => c.id === id);
        const connected = comp?.status?.connected === true;
        const was = wasConnected[id];
        wasConnected[id] = connected;
        if (was === false && connected && panelsLoadFailed()[id]) {
            void refreshPanelsForComputer(id);
        }
    });

    onMount(async () => {
        let options: LaunchOptions;
        try {
            options = await shellApi.getLaunchOptions();
        } catch (err) {
            logToMain("error", "Couldn't read the launch options; first-open tutorials are off and the layout is the desktop one until restart:", err);
            setLayoutKnown(true);
            return;
        }
        setMobile(options.mobile);
        setLayoutKnown(true);
        if (!options.firstOpenTutorials) return;
        try {
            setSeenTutorials(await loadSeenTutorials());
        } catch (err) {
            logToMain("error", "Couldn't read which tutorials were shown; first-open tutorials are off until restart:", err);
        }
    });

    // Paperboard's own tutorial the first time the app opens, then each
    // panel's the first time it is the open tab
    createEffect(() => {
        const seen = seenTutorials();
        if (!seen || openTutorial() || isSetupOpen()) return;
        if (!seen.app) {
            setOpenTutorial("app");
            return;
        }
        if (railMode() !== "computer") return;
        const compId = activeComputerId();
        const tab = getSelectedTab(compId);
        if (!tab || isShellTab(tab) || seen.panels.includes(tab)) return;
        const panel = panelsByComputer()[compId]?.find((p) => p.id === tab);
        if (panel?.tutorial?.length) setOpenTutorial({ compId, panel });
    });

    const finishTutorial = () => {
        const open = openTutorial();
        if (!open) return;
        const which = open === "app" ? "app" : { panelId: open.panel.id };
        const name = open === "app" ? "Paperboard" : open.panel.name;
        // seen before closed, or the first-open effect reopens it; this
        // session stops offering it whether or not the record saves
        batch(() => {
            setSeenTutorials((seen) => seen && withSeen(seen, which));
            setOpenTutorial(null);
        });
        // a null record stays null: finishing a tutorial opened by hand
        // doesn't turn first-open tutorials back on under --no-tutorial
        markTutorialSeen(which).then((stored) => setSeenTutorials((seen) => seen && stored), (err) =>
            logToMain("error", `Couldn't record that the ${name} tutorial was shown; it will show again next launch:`, err));
    };

    const handleShowTutorial = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        setOpenTutorial(target);
    };

    const tutorialDialog = (): OpenTutorial | null => {
        const open = openTutorial();
        if (open === "app") return { name: "Paperboard", steps: APP_TUTORIAL, imageSrc: (path) => path };
        if (!open) return null;
        const { compId, panel } = open;
        if (!panel.tutorial) return null;
        return { name: panel.name, steps: panel.tutorial, imageSrc: (path) => panelUrl(compId, panel.id, path) };
    };

    onMount(async () => {
        // Restores the active computer over privileged IPC
        await refreshComputers();

        // Data fetches are scoped per computer
        await refreshPanelsForComputer(activeComputerId());

        // Load application-wide settings before anything depends on them
        await loadAppSettings();

        // Launch lands on Home or the computer App Settings starts on, never
        // on a panel: opening the last-used panel on boot made a misbehaving
        // panel the first thing the user saw, with no deliberate action to
        // blame. Home's widgets each fail inside their own tile.
        if (computersLoaded()) {
            const start = startTarget(appSettings().startOn, listedComputers());
            if (start.missing) logToMain("error", `Paperboard starts on computer "${appSettings().startOn}", which isn't listed; opening Home.`);
            if (start.computerId) handleRailSelect(start.computerId);
        }

        // R1: the unsubscribe is kept and torn down. shell.onChanged's
        // contract returns an unsubscribe; discarding it invites every
        // future consumer to leak a live IPC listener.
        onCleanup(subscribeComputerChanges());
    });

    const finishComputerSelect = (compId: string) => {
        setActiveComputerId(compId);

        if (!activeTabByComputer()[compId]) {
            const openForComp = openedPanels().filter((key) =>
                key.startsWith(`${compId}::`),
            );
            if (openForComp.length === 0) {
                setComputerTab(compId, "landing");
            } else {
                const [, fallbackPanel] =
                    openForComp[openForComp.length - 1].split("::");
                setComputerTab(compId, fallbackPanel);
            }
        }

        void connectComputer(compId);
    };

    // why a computer couldn't be made the active one, shown in its panel list
    const [switchError, setSwitchError] = createSignal<Record<string, string>>({});
    // makes the computer the one main talks to and Paperboard reopens, then
    // lists its panels
    const connectComputer = async (compId: string) => {
        setSwitchError((prev) => ({ ...prev, [compId]: "" }));
        try {
            if (!(await computersApi.switch(compId))) throw new Error("Paperboard doesn't know this computer anymore.");
        } catch (err) {
            logToMain("error", "Failed to switch computer:", err);
            setSwitchError((prev) => ({ ...prev, [compId]: err instanceof Error ? err.message : String(err) }));
            return;
        }
        await refreshPanelsForComputer(compId);
    };

    const handleComputerSelect = async (compId: string) => {
        const comp = computers().find((c) => c.id === compId);
        if (!comp || comp.isLocal) {
            finishComputerSelect(compId);
            return;
        }

        // Probe before switching so offline computers prompt explicitly
        try {
            const probe = await computersApi.probe(comp.host, comp.port);
            if (!probe?.reachable) {
                setOfflineTarget({
                    ...comp,
                    status: { ...comp.status, connected: false, error: probe?.error },
                });
                return;
            }
        } catch (err) {
            logToMain("error", "Failed to probe computer:", err);
            setOfflineTarget(comp);
            return;
        }

        finishComputerSelect(compId);
    };

    // R4: removal is a destructive action whose failure must be visible.
    // Returns a typed result so the confirm modal can show what happened
    // instead of closing identically for success and failure.
    const handleRemoveComputer = async (
        compId: string,
    ): Promise<{ ok: boolean; error?: string }> => {
        try {
            const removed = await computersApi.remove(compId);
            if (!removed) {
                return { ok: false, error: "Paperboard could not forget that computer." };
            }
            setOpenedPanels((prev) =>
                prev.filter((k) => !k.startsWith(`${compId}::`)),
            );
            setPanelsByComputer((prev) => {
                const copy = { ...prev };
                delete copy[compId];
                return copy;
            });
            setActiveTabByComputer((prev) => {
                const copy = { ...prev };
                delete copy[compId];
                return copy;
            });
            await refreshComputers();
            await handleComputerSelect("local");
            // Paperboard can't open on a computer it forgot
            if (appSettings().startOn === compId) {
                await handleAppSettingsChange({ ...appSettings(), startOn: START_ON_HOME });
            }
            return { ok: true };
        } catch (err: any) {
            logToMain("error", "Failed to remove computer:", err);
            return {
                ok: false,
                error: err?.message
                    ? `Couldn't forget this computer: ${err.message}`
                    : "Couldn't forget this computer.",
            };
        }
    };

    const handleComputerAdded = async (newComp: any) => {
        await refreshComputers();
        if (newComp?.id) {
            await handleComputerSelect(newComp.id);
        }
    };

    const handleComputerContextMenu = (compId: string, e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenuComputerId(compId);
        computerContextMenu.openAtMouse(e);
    };

    const handleForgetFromMenu = () => {
        computerContextMenu.close();
        setForgetError(null);
        setIsForgetConfirmOpen(true);
    };

    const handleConfirmForget = async () => {
        const compId = contextMenuComputerId();
        if (!compId) return;
        setIsForgetting(true);
        try {
            const result = await handleRemoveComputer(compId);
            // R4: the modal only closes on success; a failure keeps it
            // open with the reason, so a failed forget never masquerades
            // as a successful one
            if (!result.ok) {
                setForgetError(result.error ?? "Couldn't forget this computer.");
                return;
            }
            setIsForgetConfirmOpen(false);
            setContextMenuComputerId(null);
        } finally {
            setIsForgetting(false);
        }
    };

    const forgetTargetName = () =>
        computers().find((c) => c.id === contextMenuComputerId())?.name ||
        "this computer";

    // The library runs in an iframe and asks for installs over postMessage;
    // the install path is unchanged — daemon RPC, refresh, open the panel.
    const handleLibraryInstall = async (panelId: string) => {
        const compId = activeComputerId();
        await panelsApi.install(panelId, compId);
        await refreshPanelsForComputer(compId);
        setComputerTab(compId, panelId);
    };

    // Panels the registry doesn't list still get a full library page: read
    // their own manifest and store/ files through the panel:// surface.
    const handleLibraryMedia = (panelId: string, full: boolean) => {
        const compId = activeComputerId();
        return loadInstalledPanelMedia(
            (path) => readPanelListingFile(compId, panelId, path),
            full,
        );
    };

    const handleLibraryOpen = (panelId: string) => {
        setComputerTab(activeComputerId(), panelId);
    };

    const renderPanelIcon = (panel: PanelItem, compId: string) => {
        if (panel.iconUrl) {
            return <img src={panel.iconUrl} alt={panel.name} class={iconStyles.panelIcon} />;
        }
        if (panel.icon?.includes(".")) {
            return (
                <img
                    src={panelUrl(compId, panel.id, panel.icon)}
                    alt={panel.name}
                    class={iconStyles.panelIcon}
                />
            );
        }
        return panel.icon || "dashboard";
    };

    const showTopBar = () =>
        !mobile() || packageUpdates.state().notices.length > 0 || appUpdate.state().status === "ready";

    // the mobile page's top bar: the open tab's icon and name
    const mobilePageHeading = (): { title: string; icon: JSX.Element } => {
        const compId = activeComputerId();
        const tab = getSelectedTab(compId);
        const comp = activeComputer();
        if (tab === "library") {
            return {
                title: "Panel Library",
                icon: <img src={libraryIcon} alt="" class={iconStyles.panelIcon} />,
            };
        }
        if (isShellTab(tab)) {
            return { title: comp?.name || "This Computer", icon: comp ? computerIcon(comp) : "computer" };
        }
        const panel = panelsByComputer()[compId]?.find((p) => p.id === tab);
        if (!panel) return { title: tab, icon: "dashboard" };
        return { title: panel.name, icon: renderPanelIcon(panel, compId) };
    };

    return (
        <PaperProvider
            theme={appSettings().darkMode}
            styleBody
            unselectable
        >
            <PaperFlex
                direction="column"
                inert={mobileSettingsOpen()}
                class={styles.window}
                overflow="hidden"
            >
                {/* a phone has no window title to show: the bar comes only to say an update is waiting */}
                <Show when={showTopBar()}>
                <TopBar
                    updateState={appUpdate.state()}
                    onOpenUpdate={() => appUpdate.setOpen(true)}
                    packageUpdatesWaiting={packageUpdates.state().notices.length}
                    onOpenPackageUpdates={() => packageUpdates.setOpen(true)}
                    getComputerId={activeComputerId}
                    getSelectedTab={() => getSelectedTab(activeComputerId())}
                    mobile={mobile()}
                    inert={mobilePageOpen()}
                />
                </Show>
                <PaperFlex
                    direction="row"
                    flex={1}
                    overflow="hidden"
                    class={styles.main}
                    classList={{ [styles.underTopBar]: showTopBar() }}
                >
                    <Show
                        when={!mobileWelcome()}
                        fallback={
                            // nothing until the paired computers are known, so a paired phone never flashes the welcome
                            <Show when={computersLoaded() || computersLoadFailed()}>
                                <MobileWelcome
                                    onAdd={() => setIsSetupOpen(true)}
                                    loadFailed={computersLoadFailed()}
                                    onRetryLoad={() => void refreshComputers()}
                                />
                            </Show>
                        }
                    >
                    <ComputerRail
                        updateState={appUpdate.state()}
                        showUpdate={railMode() === "home" || (railMode() === "computer" && getSelectedTab(activeComputerId()) === "landing")}
                        onOpenUpdate={() => appUpdate.setOpen(true)}
                        computers={listedComputers()}
                        value={
                            railMode() === "home"
                                ? "__home"
                                : railMode() === "settings"
                                  ? "__settings"
                                  : activeComputerId()
                        }
                        onSelect={(val) => handleRailSelect(val)}
                        onAdd={() => setIsSetupOpen(true)}
                        onComputerContextMenu={handleComputerContextMenu}
                        loadFailed={computersLoadFailed()}
                        onRetryLoad={() => void refreshComputers()}
                        inert={mobilePageOpen()}
                    />

                    <Show
                        when={!showAppSettings()}
                        fallback={
                            <PaperFlex
                                direction="column"
                                fullWidth
                                fullHeight
                                flex={1}
                                overflowY="auto"
                            >
                                <AppSettings
                                    settings={appSettings()}
                                    panelName={(panelId) => Object.values(panelsByComputer()).flat().find((p) => p.id === panelId)?.name || panelId}
                                    onChange={handleAppSettingsChange}
                                    onShowTutorial={() => setOpenTutorial("app")}
                                    computers={listedComputers()}
                                    failure={settingsFailure()}
                                    onRetryLoad={() => void retryLoadAppSettings()}
                                    onDismissFailure={dismissSettingsFailure}
                                />
                            </PaperFlex>
                        }
                    >
                    {/* hidden, not unmounted, while Home shows: open
                        panels keep their frames and come back as left */}
                    <PaperFlex
                        direction="row"
                        fullHeight
                        flex={1}
                        overflow="hidden"
                        class={styles.computerArea}
                        hidden={railMode() !== "computer"}
                    >
                        <Show
                            when={
                                activeComputer() &&
                                !activeComputer()?.isLocal &&
                                !activeComputer()?.status?.connected
                            }
                        >
                            <ConnectionLostOverlay
                                computer={activeComputer()!}
                                onReconnectSuccess={handleReconnectSuccess}
                            />
                        </Show>

                        <PaperFlex
                            direction="column"
                            background="surface-inset"
                            inert={mobilePageOpen()}
                            fullHeight
                            shrink={0}
                            overflow="hidden"
                            class={styles.sidebar}
                            classList={{ [styles.phone]: mobile() }}
                        >
                            <For each={listedComputers()}>
                                {(comp) => {
                                    const isActive = () =>
                                        activeComputerId() === comp.id;
                                    const compTab = () =>
                                        getSelectedTab(comp.id);
                                    const compPanels = () =>
                                        panelsByComputer()[comp.id] || [];

                                    return (
                                        <PaperFlex
                                            direction="column"
                                            fullWidth
                                            fullHeight
                                            gap={getVarCss("border-width")}
                                            overflow="hidden"
                                            class={styles.computerColumn}
                                            hidden={!isActive()}
                                        >
                                            <ComputerHeader
                                                computer={comp}
                                                selectedTab={compTab()}
                                                onSelectTab={(tab) =>
                                                    setComputerTab(comp.id, tab)
                                                }
                                                onActivateTab={openMobilePage}
                                                onLibraryContextMenu={(
                                                    e: MouseEvent,
                                                ) =>
                                                    libraryContextMenu.openAtMouse(
                                                        e,
                                                    )
                                                }
                                            />

                                            <PaperList
                                                name={`installed-panel-${comp.id}`}
                                                value={compTab()}
                                                onValueChange={(val) =>
                                                    setComputerTab(
                                                        comp.id,
                                                        String(val),
                                                    )
                                                }
                                                class={styles.panelList}
                                            >
                                                <For each={compPanels()}>
                                                    {(panel) => (
                                                        <PaperListItem
                                                            value={panel.id}
                                                            onClick={openMobilePage}
                                                            icon={renderPanelIcon(
                                                                panel,
                                                                comp.id,
                                                            )}
                                                            onContextMenu={(
                                                                e: MouseEvent,
                                                            ) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setContextMenuPanel(
                                                                    {
                                                                        compId: comp.id,
                                                                        panel,
                                                                    },
                                                                );
                                                                panelContextMenu.openAtMouse(
                                                                    e,
                                                                );
                                                            }}
                                                        >
                                                            {panel.name}
                                                        </PaperListItem>
                                                    )}
                                                </For>
                                                <Show when={switchError()[comp.id]}>
                                                    <PaperFlex direction="column" padding="half">
                                                        <PaperQuote variant="danger" icon="warning" title="Computer not switched" role="alert">
                                                            <PaperFlex direction="column" gap="half" align="flex-start">
                                                                {switchError()[comp.id]}
                                                                <PaperButton size="tiny" onClick={() => void connectComputer(comp.id)}>
                                                                    Retry
                                                                </PaperButton>
                                                            </PaperFlex>
                                                        </PaperQuote>
                                                    </PaperFlex>
                                                </Show>
                                                <Show when={!switchError()[comp.id] && panelsLoadError()[comp.id] && compPanels().length === 0}>
                                                    <PaperFlex direction="column" padding="half">
                                                        <PaperQuote variant="danger" icon="warning" title="Panels not loaded" role="alert">
                                                            <PaperFlex direction="column" gap="half" align="flex-start">
                                                                {panelsLoadError()[comp.id]}
                                                                <PaperButton size="tiny" onClick={() => void refreshPanelsForComputer(comp.id)}>
                                                                    Retry
                                                                </PaperButton>
                                                            </PaperFlex>
                                                        </PaperQuote>
                                                    </PaperFlex>
                                                </Show>
                                            </PaperList>
                                        </PaperFlex>
                                    );
                                }}
                            </For>
                        </PaperFlex>

                        <PaperSlidePage
                            position="fixed"
                            enabled={mobile()}
                            open={mobilePageOpen()}
                            title={mobilePageHeading().title}
                            icon={mobilePageHeading().icon}
                            onBack={() => setMobilePageOpen(false)}
                        >
                        <PaperFlex
                            direction="column"
                            fullHeight
                            flex={1}
                            overflow="hidden"
                            class={styles.computerArea}
                        >
                            <For each={listedComputers()}>
                                {(comp) => {
                                    const isVisible = () =>
                                        activeComputerId() === comp.id &&
                                        getSelectedTab(comp.id) === "landing";
                                    return (
                                        <PaperFlex
                                            direction="column"
                                            fullHeight
                                            flex={1}
                                            overflow="hidden"
                                            hidden={!isVisible()}
                                        >
                                            <LandingView computer={comp} />
                                        </PaperFlex>
                                    );
                                }}
                            </For>

                            <PaperFlex
                                direction="column"
                                fullHeight
                                overflow="hidden"
                                class={styles.frameLayer}
                                classList={{ [styles.away]: getSelectedTab(activeComputerId()) !== "library" }}
                            >
                                <LibraryFrame
                                    active={
                                        getSelectedTab(activeComputerId()) ===
                                        "library"
                                    }
                                    theme={appSettings().darkMode}
                                    installed={
                                        panelsByComputer()[
                                            activeComputerId()
                                        ] || []
                                    }
                                    onInstall={handleLibraryInstall}
                                    onOpen={handleLibraryOpen}
                                    loadMedia={handleLibraryMedia}
                                    reloadToken={libraryReloadToken()}
                                    onReload={reloadLibrary}
                                />
                            </PaperFlex>

                            <For each={listedComputers()}>
                                {(comp) => {
                                    const isVisible = () =>
                                        activeComputerId() === comp.id &&
                                        getSelectedTab(comp.id) === "settings";
                                    return (
                                        <PaperFlex
                                            direction="column"
                                            fullHeight
                                            flex={1}
                                            overflowY="auto"
                                            hidden={!isVisible()}
                                        >
                                            <ComputerSettings
                                                computer={comp}
                                                onRemove={handleRemoveComputer}
                                            />
                                        </PaperFlex>
                                    );
                                }}
                            </For>

                            {/* like the library layer: never tear down a live
                                panel iframe on a tab switch */}
                            <PaperFlex
                                direction="column"
                                fullHeight
                                overflow="hidden"
                                class={styles.frameLayer}
                                classList={{ [styles.away]: isShellTab(getSelectedTab(activeComputerId())) }}
                            >
                                <PanelView
                                    activePanel={getSelectedTab(
                                        activeComputerId(),
                                    )}
                                    activeComputerId={activeComputerId()}
                                    computerName={(id) => computers().find((c) => c.id === id)?.name || "This Computer"}
                                    openedPanels={openedPanels()}
                                    reloadTokens={reloadTokens()}
                                    onReloadPanel={bumpReloadToken}
                                    restartStates={restartStates()}
                                    onRestartPanel={(key) => {
                                        const [compId, panelId] = key.split("::");
                                        const name = panelsByComputer()[compId]?.find((p) => p.id === panelId)?.name || panelId;
                                        void restartPanel(compId, panelId, name);
                                    }}
                                />
                            </PaperFlex>
                        </PaperFlex>
                        </PaperSlidePage>
                    </PaperFlex>
                    </Show>

                    <Show when={layoutKnown()}>
                    <HomeView
                        mobile={mobile()}
                        visible={railMode() === "home"}
                        computers={listedComputers()}
                        panelsByComputer={panelsByComputer()}
                        panelsLoadFailed={panelsLoadFailed()}
                        onRefreshPanels={(compId) => void refreshPanelsForComputer(compId)}
                        onOpenPanel={openPanelFromHome}
                        onOpenComputer={(compId) => handleRailSelect(compId)}
                        reloadTokens={reloadTokens()}
                    />
                    </Show>
                    </Show>
                </PaperFlex>
            </PaperFlex>

            <Show when={mobile()}>
                <PaperSlidePage
                    position="fixed"
                    enabled
                    open={mobileSettingsOpen()}
                    title="Settings"
                    icon="settings"
                    onBack={() => setMobileSettingsOpen(false)}
                >
                    <PaperFlex direction="column" flex={1} minHeight={0} overflowY="auto">
                        <AppSettings
                            compact
                            settings={appSettings()}
                            onChange={handleAppSettingsChange}
                            onShowTutorial={() => setOpenTutorial("app")}
                            computers={listedComputers()}
                            failure={settingsFailure()}
                            onRetryLoad={() => void retryLoadAppSettings()}
                            onDismissFailure={dismissSettingsFailure}
                        />
                    </PaperFlex>
                </PaperSlidePage>
            </Show>

            {/* browser mode: the browser asks itself */}
            <Show when={!isBrowserShell()}>
                <PanelPermissionPrompt
                    panelName={(compId, panelId) => panelsByComputer()[compId]?.find((p) => p.id === panelId)?.name || panelId}
                />
            </Show>
            <AppUpdateModal state={appUpdate.state()} open={appUpdate.open()} onClose={() => appUpdate.setOpen(false)} />
            <PackageUpdateModal
                state={packageUpdates.state()}
                error={packageUpdates.error()}
                open={packageUpdates.open()}
                onClose={() => packageUpdates.setOpen(false)}
                onRefresh={() => void packageUpdates.refresh()}
            />

            <OfflineComputerModal
                open={!!offlineTarget()}
                computer={offlineTarget() ?? undefined}
                onClose={() => setOfflineTarget(null)}
                onForget={() => {
                    const comp = offlineTarget();
                    if (!comp) return;
                    setOfflineTarget(null);
                    setForgetError(null);
                    setContextMenuComputerId(comp.id);
                    setIsForgetConfirmOpen(true);
                }}
                onReconnectSuccess={async () => {
                    const comp = offlineTarget();
                    if (!comp) return;
                    setOfflineTarget(null);
                    await refreshComputers();
                    finishComputerSelect(comp.id);
                }}
            />

            <PaperModal
                open={isSetupOpen()}
                aria-label="Connect a computer"
                onClose={() => setIsSetupOpen(false)}
                noHeader
                noPadding
                size="medium"
            >
                <Show when={setupShown()} keyed>
                    <ComputerSetupWizard
                        onClose={() => setIsSetupOpen(false)}
                        onComplete={handleComputerAdded}
                    />
                </Show>
            </PaperModal>

            <PanelContextMenu
                menu={panelContextMenu}
                onClose={() => {
                    panelContextMenu.close();
                    setContextMenuPanel(null);
                }}
                onRestart={handleRestartPanel}
                onUninstall={handleRequestUninstall}
                onShowTutorial={contextMenuPanel()?.panel.tutorial?.length ? handleShowTutorial : undefined}
            />

            <TutorialDialog
                tutorial={tutorialDialog()}
                theme={appSettings().darkMode}
                onDone={finishTutorial}
                compact={mobile()}
            />

            <ComputerContextMenu
                menu={computerContextMenu}
                onForget={handleForgetFromMenu}
            />

            <LibraryContextMenu
                menu={libraryContextMenu}
                onClose={() => libraryContextMenu.close()}
                onReload={() => {
                    libraryContextMenu.close();
                    reloadLibrary();
                }}
            />

            <PaperModal
                open={isForgetConfirmOpen()}
                onClose={() => {
                    if (!isForgetting()) {
                        setIsForgetConfirmOpen(false);
                        setContextMenuComputerId(null);
                    }
                }}
                title="Forget Computer"
                size="small"
                footer={
                    <>
                        <PaperButton
                            variant="text"
                            onClick={() => {
                                setIsForgetConfirmOpen(false);
                                setContextMenuComputerId(null);
                            }}
                            disabled={isForgetting()}>
                            Cancel
                        </PaperButton>
                        <PaperButton
                            variant="danger"
                            disabled={isForgetting()}
                            onClick={handleConfirmForget}>
                            {isForgetting() ? "Removing..." : "Forget Computer"}
                        </PaperButton>
                    </>
                }
            >
                <PaperText preset="text">
                    Are you sure you want to forget{" "}
                    <strong>{forgetTargetName()}</strong>?
                </PaperText>
                <Show when={forgetError()}>
                    <PaperText preset="error">
                        {forgetError()}
                    </PaperText>
                </Show>
            </PaperModal>

            <UninstallPanelModal
                open={isUninstallModalOpen()}
                target={uninstallTarget()}
                isBusy={isUninstalling()}
                error={uninstallError()}
                deleteData={uninstallDeleteData()}
                onDeleteDataChange={setUninstallDeleteData}
                onClose={() => {
                    if (!isUninstalling()) {
                        setIsUninstallModalOpen(false);
                        setUninstallTarget(null);
                        setUninstallDeleteData(false);
                        setUninstallError(null);
                    }
                }}
                onConfirm={handleConfirmUninstall}
            />
        </PaperProvider>
    );
};

export default App;
