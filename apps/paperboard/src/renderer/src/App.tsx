import { type Component, type JSX, createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js";
import {
    PaperProvider,
    PaperFlex,
    PaperModal,
    PaperSlidePage,
    showToast,
} from "@mileniumhq/paperui";
import { loadInstalledPanelMedia, panelsApi } from "@mileniumhq/paperapi";
import {
    computersApi,
    isBrowserShell,
    logToMain,
    shellApi,
    readPanelListingFile,
} from "./lib/shell";
import { mobileMode, setMobileMode } from "./lib/mobileMode";
import AppSettings from "./components/settings/AppSettings";
import PanelPermissionPrompt from "./components/panels/PanelPermissionPrompt";
import PanelView from "./components/panels/PanelView";
import LibraryFrame from "./components/panels/LibraryFrame";
import type { PanelHeading } from "./components/panels/PanelView";
import type { UninstallTarget } from "./components/panels/UninstallPanelModal";
import { createPanelDialogs } from "./components/panels/panelDialogs";
import LandingView from "./components/computer/LandingView";
import ComputerSetupWizard from "./components/wizard/ComputerSetupWizard";
import ComputerSettings from "./components/computer/ComputerSettings";
import ComputerSidebar from "./components/computer/ComputerSidebar";
import { createComputerDialogs } from "./components/computer/computerDialogs";
import PanelIcon from "./components/computer/PanelIcon";
import { isShellTab } from "./lib/shellTabs";
import { createShownWhileClosing } from "./lib/openings";
import ConnectionLostOverlay from "./components/computer/ConnectionLostOverlay";
import OfflineComputerModal from "./components/computer/OfflineComputerModal";
import ComputerRail from "./components/computer/ComputerRail";
import HomeView from "./components/home/HomeView";
import AppUpdateModal from "./components/layout/AppUpdateModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useUpdateQueue } from "./hooks/useUpdateQueue";
import { pendingUpdates } from "../../shared/updateQueue";
import TopBar from "./components/layout/TopBar";
import { computerIcon } from "./components/computer/computerIcon";
import MobileWelcome from "./components/computer/MobileWelcome";
import { orderWithShown, shownComputers, showsWelcome } from "./lib/phoneComputers";
import libraryIcon from "./assets/PanelLibrary.png";
import styles from "./App.module.css";
import iconStyles from "./components/computer/panelIcon.module.css";
import { useAppSettings } from "./hooks/useAppSettings";
import { startTarget } from "./lib/startOn";
import { useComputers } from "./hooks/useComputers";
import { useComputerSelection } from "./hooks/useComputerSelection";
import { usePanels } from "./hooks/usePanels";
import { usePanelRestarts } from "./hooks/usePanelRestarts";
import { askPanelToLeave, unsavedPanels } from "./lib/unsavedPanels";
import { errorMessage } from "./lib/errorMessage";

const App: Component = () => {
    const appUpdate = useAppUpdate();
    const updateQueue = useUpdateQueue();
    const computerState = useComputers();
    const {
        computers,
        setComputers,
        activeComputerId,
        offlineTarget,
        setOfflineTarget,
        refreshComputers,
        activeComputer,
        subscribeComputerChanges,
        computersLoadFailed,
        computersLoaded,
    } = computerState;
    const panelState = usePanels();
    const {
        panelsByComputer,
        invalidPanelsByComputer,
        openedPanels,
        setOpenedPanels,
        reloadTokens,
        setReloadTokens,
        panelsLoadFailed,
        panelsLoadError,
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
    } = panelState;
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
    // the wizard stays through the fade and starts over on the next open
    const setupShown = createShownWhileClosing(isSetupOpen);
    const panelName = (compId: string, panelId: string) =>
        panelsByComputer()[compId]?.find((p) => p.id === panelId)?.name || panelId;
    const {
        appSettings,
        graphics,
        loadAppSettings,
        handleAppSettingsChange,
        settingsFailure,
        retryLoadAppSettings,
        dismissSettingsFailure,
    } = useAppSettings();
    const selection = useComputerSelection({
        computers: computerState,
        panels: panelState,
        appSettings,
        onAppSettingsChange: handleAppSettingsChange,
    });
    // what the main area shows: Home (where Paperboard opens), app
    // settings, or the active computer's panels
    const [railMode, setRailMode] = createSignal<"home" | "settings" | "computer">("home");
    const showAppSettings = () => railMode() === "settings";
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

    const handleRailSelect = (val: string) => {
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
                showToast({ variant: "danger", title: `${panelName(compId, panelId)} couldn't ask about its unsaved changes`, message: answer.error });
            }
            if (!answer.leave) return false;
        }
        return true;
    };

    const { restartStates, setRestartState, restartPanel, bumpReloadToken, updatingPanels } = usePanelRestarts({
        updateQueue,
        setReloadTokens,
        setComputerTab,
        mayClosePanels,
        refreshPanelsForComputer,
    });

    const panelDialogs = createPanelDialogs({
        restartPanel,
        mayClosePanel: (key) => mayClosePanels([key]),
        // the panel is gone: its frame closes, and its tab with it
        onUninstalled: async (target: UninstallTarget) => {
            const key = `${target.compId}::${target.panel.id}`;
            setOpenedPanels((prev) => prev.filter((k) => k !== key));
            setRestartState(key, null);
            if (getSelectedTab(target.compId) === target.panel.id) {
                setComputerTab(target.compId, "landing");
                // the phone layout's landing is the panel list underneath
                setMobilePageOpen(false);
            }
            await refreshPanelsForComputer(target.compId);
        },
    });

    const computerDialogs = createComputerDialogs({
        computers,
        mayLeaveComputer: (compId) => mayClosePanels(openedPanels().filter((key) => key.startsWith(`${compId}::`))),
        openComputerInfo: (compId) => openComputerTab(compId, "settings"),
        forgetComputer: selection.forgetComputer,
    });

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

    onMount(() => {
        // Subscribed before the first load, so a computer's status pushed
        // while it is read isn't missed, and torn down with the window.
        onCleanup(subscribeComputerChanges());
        void startUp();
    });

    const startUp = async () => {
        // Application-wide settings are read first, beside the daemon calls
        // rather than behind them, so the theme and motion are the user's
        // from the start
        const settingsLoaded = loadAppSettings();

        // Restores the active computer over privileged IPC
        await refreshComputers();

        // Data fetches are scoped per computer
        await refreshPanelsForComputer(activeComputerId());

        await settingsLoaded;

        // Launch lands on Home or the computer App Settings starts on, never
        // on a panel: opening the last-used panel on boot made a misbehaving
        // panel the first thing the user saw, with no deliberate action to
        // blame. Home's widgets each fail inside their own tile.
        if (computersLoaded()) {
            const start = startTarget(appSettings().startOn, listedComputers());
            if (start.missing) logToMain("error", `Paperboard starts on computer "${appSettings().startOn}", which isn't listed; opening Home.`);
            if (start.computerId) handleRailSelect(start.computerId);
        }
    };

    // the rail moves at once; a failed save says so and puts it back
    const handleReorderComputers = async (shownIds: string[]) => {
        const before = [...computers()];
        const ids = orderWithShown(before.map((c) => c.id), shownIds);
        const byId = new Map(before.map((c) => [c.id, c]));
        setComputers(ids.map((id) => byId.get(id)!));
        try {
            await computersApi.reorder(ids);
        } catch (err) {
            logToMain("error", "Failed to reorder computers:", err);
            setComputers(before);
            showToast({
                variant: "danger",
                title: "Couldn't move that computer",
                message: errorMessage(err),
            });
            void refreshComputers();
        }
    };

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

    // A panel's loader heads itself with the panel's icon and name. Asked
    // once per frame: the heading follows the panel from then on, and each
    // loader that shows it draws its own icon, so nothing is redrawn when
    // something else about the panels changes.
    const panelHeading = (key: string): PanelHeading => {
        const [compId, panelId] = key.split("::");
        const panel = createMemo(() => panelsByComputer()[compId]?.find((p) => p.id === panelId));
        return {
            get icon() {
                return <PanelIcon computerId={compId} panel={panel()} />;
            },
            get name() {
                return panel()?.name ?? panelId;
            },
            get serviceError() {
                return panel()?.serviceError;
            },
        };
    };

    const showTopBar = () =>
        !mobile() ||
        pendingUpdates(updateQueue.state()).length > 0 ||
        updateQueue.state().holds.length > 0 ||
        appUpdate.state().status === "ready";

    // the mobile page's top bar: the open tab's icon and name
    const mobilePageHeading = createMemo((): { title: string; icon: JSX.Element } => {
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
        return { title: panel.name, icon: <PanelIcon computerId={compId} panel={panel} /> };
    });

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
                    updateQueue={updateQueue.state()}
                    onReleaseUpdate={updateQueue.release}
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
                        onComputerContextMenu={computerDialogs.openMenu}
                        onReorder={(ids) => void handleReorderComputers(ids)}
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
                                    computers={listedComputers()}
                                    failure={settingsFailure()}
                                    gpu={graphics().gpu}
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
                                onReconnectSuccess={() => void selection.reconnected(activeComputerId())}
                            />
                        </Show>

                        <ComputerSidebar
                            computers={listedComputers()}
                            activeComputerId={activeComputerId()}
                            selectedTab={getSelectedTab}
                            onSelectTab={setComputerTab}
                            onActivateTab={openMobilePage}
                            panelsByComputer={panelsByComputer()}
                            invalidPanelsByComputer={invalidPanelsByComputer()}
                            updatingPanels={updatingPanels()}
                            switchError={selection.switchError()}
                            onRetrySwitch={(compId) => void selection.connectComputer(compId)}
                            panelsLoadError={panelsLoadError()}
                            onRetryPanels={(compId) => void refreshPanelsForComputer(compId)}
                            onPanelContextMenu={panelDialogs.openPanelMenu}
                            onLibraryContextMenu={panelDialogs.openLibraryMenu}
                            mobile={mobile()}
                            inert={mobilePageOpen()}
                        />

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
                                    reloadToken={panelDialogs.libraryReloadToken()}
                                    onReload={panelDialogs.reloadLibrary}
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
                                                onForget={() => void computerDialogs.openForget(comp.id)}
                                                onChangeName={() => computerDialogs.openRename(comp.id)}
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
                                {/* a frame is told mobile mode as it loads, so it waits for the launch options */}
                                <Show when={layoutKnown()}>
                                <PanelView
                                    panelHeading={panelHeading}
                                    mobile={mobile()}
                                    activePanel={getSelectedTab(
                                        activeComputerId(),
                                    )}
                                    activeComputerId={activeComputerId()}
                                    computerName={(id) => computers().find((c) => c.id === id)?.name || "This Computer"}
                                    openedPanels={openedPanels()}
                                    reloadTokens={reloadTokens()}
                                    onReloadPanel={bumpReloadToken}
                                    restartStates={restartStates()}
                                    onPanelFailed={(key) => void refreshPanelsForComputer(key.split("::")[0])}
                                    onRestartPanel={(key) => {
                                        const [compId, panelId] = key.split("::");
                                        void restartPanel(compId, panelId, panelName(compId, panelId));
                                    }}
                                />
                                </Show>
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
                        onOpenPanel={openComputerTab}
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
                            computers={listedComputers()}
                            failure={settingsFailure()}
                            gpu={graphics().gpu}
                            onRetryLoad={() => void retryLoadAppSettings()}
                            onDismissFailure={dismissSettingsFailure}
                        />
                    </PaperFlex>
                </PaperSlidePage>
            </Show>

            {/* browser mode: the browser asks itself */}
            <Show when={!isBrowserShell()}>
                <PanelPermissionPrompt
                    panelName={panelName}
                />
            </Show>
            <AppUpdateModal state={appUpdate.state()} open={appUpdate.open()} onClose={() => appUpdate.setOpen(false)} />

            <OfflineComputerModal
                open={!!offlineTarget()}
                computer={offlineTarget() ?? undefined}
                onClose={() => setOfflineTarget(null)}
                onForget={() => {
                    const comp = offlineTarget();
                    if (!comp) return;
                    setOfflineTarget(null);
                    void computerDialogs.openForget(comp.id);
                }}
                onReconnectSuccess={() => {
                    const comp = offlineTarget();
                    if (!comp) return;
                    setOfflineTarget(null);
                    void selection.reconnected(comp.id);
                }}
            />

            <PaperModal
                open={isSetupOpen()}
                aria-label="Connect a computer"
                onClose={() => setIsSetupOpen(false)}
                noHeader
                noPadding
                size="large"
            >
                <Show when={setupShown()} keyed>
                    <ComputerSetupWizard
                        onClose={() => setIsSetupOpen(false)}
                        onComplete={selection.addComputer}
                    />
                </Show>
            </PaperModal>

            <panelDialogs.Dialogs />
            <computerDialogs.Dialogs />
        </PaperProvider>
    );
};

export default App;
