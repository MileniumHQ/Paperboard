import { type Component, createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js";
import { PaperProvider, PaperFlex, PaperModal, PaperSlidePage, showError } from "@mileniumhq/paperui";
import { isBrowserShell, quitApi } from "./lib/shell";
import { setMobileMode } from "./lib/mobileMode";
import { showsNoComputers } from "./lib/hostComputers";
import { unsavedPanels } from "./lib/unsavedPanels";
import AppSettings, { type HostSettingsGroup } from "./components/settings/AppSettings";
import PanelPermissionPrompt from "./components/panels/PanelPermissionPrompt";
import type { UninstallTarget } from "./components/panels/UninstallPanelModal";
import { createPanelDialogs } from "./components/panels/panelDialogs";
import ComputerSetupWizard from "./components/wizard/ComputerSetupWizard";
import ComputerArea from "./components/computer/ComputerArea";
import { createComputerDialogs } from "./components/computer/computerDialogs";
import { createShownWhileClosing } from "./lib/openings";
import OfflineComputerModal from "./components/computer/OfflineComputerModal";
import ComputerRail from "./components/computer/ComputerRail";
import HomeView from "./components/home/HomeView";
import AppUpdateModal from "./components/layout/AppUpdateModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useUpdateQueue } from "./hooks/useUpdateQueue";
import { pendingUpdates } from "../../shared/updateQueue";
import TopBar from "./components/layout/TopBar";
import styles from "./App.module.css";
import { useAppSettings } from "./hooks/useAppSettings";
import { useComputers } from "./hooks/useComputers";
import { useComputerSelection } from "./hooks/useComputerSelection";
import { usePanels } from "./hooks/usePanels";
import { usePanelRestarts } from "./hooks/usePanelRestarts";
import { useShellNavigation } from "./hooks/useShellNavigation";
import { useStartUp } from "./hooks/useStartUp";

/** what the shell is placed in: the desktop app's window by default */
export interface AppProps {
    /** "phone": the rail and panel list fill the screen, and what's opened
     * from them slides in over them as its own page. It may change while the
     * App runs (a foldable opening); what's open carries over. */
    layout?: "desktop" | "phone";
    /** shown instead of the rail and Home while the host lists no computers.
     * The desktop app always has This Computer; a host without one passes this. */
    noComputers?: Component<{ onAdd: () => void; loadFailed: boolean; onRetryLoad: () => void }>;
    /** whether the host can open a computer's folder in a file manager beside
     * the person. The desktop app can; a host serving a browser elsewhere can't. */
    opensFolders?: boolean;
    /** what "Add Computer" opens, for a host that adds computers some other
     * way than pairing over the network: a modal of its own, shown while
     * `open`. Defaults to the pairing wizard. */
    addComputer?: Component<{ open: boolean; onClose: () => void }>;
    /** a group the host adds to the top of App Settings, such as the
     * account it's signed in to */
    hostSettings?: HostSettingsGroup;
    /** Use the system motion preference when the host manages accessibility. */
    motion?: "settings" | "system";
    /** false: the wide layout draws no title bar (the phone app has no window
     * to name); the bar still comes to say an update is waiting. Default true. */
    windowBar?: boolean;
    /** true in the phone app: the shell and its panels take touch behavior
     * (PaperUI's mobile mode). Not the layout: a narrow browser window gets
     * the phone layout with a mouse's behavior. Default false. */
    mobileMode?: boolean;
    /** the shell lists only paired computers: the desktop app's phone mock
     * runs no panels of its own. Default false. */
    hidesThisComputer?: boolean;
}

const App: Component<AppProps> = (props) => {
    // mobile mode is the host's to say; set before any frame is told
    setMobileMode(props.mobileMode ?? false);
    createEffect(on(() => props.mobileMode ?? false, setMobileMode, { defer: true }));
    const appUpdate = useAppUpdate();
    const updateQueue = useUpdateQueue();
    const computerState = useComputers();
    const { computers, activeComputerId, offlineTarget, setOfflineTarget, refreshComputers, computersLoadFailed, computersLoaded } = computerState;
    const panelState = usePanels();
    const { panelsByComputer, openedPanels, setOpenedPanels, reloadTokens, panelsLoadFailed, getSelectedTab, setComputerTab, refreshPanelsForComputer } = panelState;
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
    // the wizard stays through the fade and starts over on the next open
    const setupShown = createShownWhileClosing(isSetupOpen);
    const panelName = (compId: string, panelId: string) =>
        panelsByComputer()[compId]?.find((p) => p.id === panelId)?.name || panelId;
    const settings = useAppSettings(() => props.motion === "system");
    const { appSettings, graphics, handleAppSettingsChange, loadError, retryLoadAppSettings } = settings;
    const selection = useComputerSelection({
        computers: computerState,
        panels: panelState,
        appSettings,
        onAppSettingsChange: handleAppSettingsChange,
    });
    const nav = useShellNavigation({ computers: computerState, panels: panelState, selection, panelName, layout: () => props.layout ?? "desktop", hidesThisComputer: () => props.hidesThisComputer ?? false });
    const { mobile, listedComputers } = nav;
    // a phone, and the phone app in any layout, follows the system's light
    // and dark; neither has a theme setting
    const theme = () => (mobile() || props.motion === "system" ? "system" : appSettings().darkMode);
    const noComputers = () => showsNoComputers(Boolean(props.noComputers), computersLoaded(), listedComputers().length);
    // the last computer forgotten: Home is what's left
    createEffect(on(noComputers, (none) => { if (none && nav.railMode() === "computer") nav.selectRail("__home"); }, { defer: true }));
    useStartUp({ computers: computerState, panels: panelState, settings, navigation: nav });

    // a quit asks this window's pages with unsaved work first (main's quitGate.ts)
    if (!isBrowserShell()) {
        const holdsUnsaved = createMemo(() => unsavedPanels().size > 0);
        createEffect(on(holdsUnsaved, (unsaved) => {
            quitApi.setUnsaved(unsaved).catch((err) =>
                showError("Quitting won't ask about unsaved changes", err));
        }));
        onCleanup(quitApi.onAsk(async ({ askId }) => {
            const quit = await nav.mayClosePanels([...unsavedPanels()]);
            await quitApi.answer(askId, quit).catch((err) =>
                showError("Paperboard couldn't quit", err));
        }));
    }

    const restarts = usePanelRestarts({
        updateQueue,
        setReloadTokens: panelState.setReloadTokens,
        setComputerTab,
        mayClosePanels: nav.mayClosePanels,
        refreshPanelsForComputer,
    });

    const panelDialogs = createPanelDialogs({
        restartPanel: restarts.restartPanel,
        mayClosePanel: (key) => nav.mayClosePanels([key]),
        // the panel is gone: its frame closes, and its tab with it
        onUninstalled: async (target: UninstallTarget) => {
            const key = `${target.compId}::${target.panel.id}`;
            setOpenedPanels((prev) => prev.filter((k) => k !== key));
            restarts.setRestartState(key, null);
            if (getSelectedTab(target.compId) === target.panel.id) {
                setComputerTab(target.compId, "landing");
                // the phone layout's landing is the panel list underneath
                nav.setMobilePageOpen(false);
            }
            await refreshPanelsForComputer(target.compId);
        },
    });

    const computerDialogs = createComputerDialogs({
        computers,
        mayLeaveComputer: (compId) => nav.mayClosePanels(openedPanels().filter((key) => key.startsWith(`${compId}::`))),
        openComputerInfo: (compId) => nav.openComputerTab(compId, "settings"),
        forgetComputer: selection.forgetComputer,
    });

    const showTopBar = () =>
        (!mobile() && props.windowBar !== false) ||
        pendingUpdates(updateQueue.state()).length > 0 ||
        updateQueue.state().holds.length > 0 ||
        appUpdate.state().status === "ready";

    return (
        <PaperProvider
            theme={theme()}
            styleBody
            unselectable
        >
            <PaperFlex
                direction="column"
                inert={nav.mobileSettingsOpen()}
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
                    opensFolders={props.opensFolders ?? true}
                    inert={nav.mobilePageOpen()}
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
                        when={!noComputers()}
                        fallback={
                            // nothing until the computers are known, so a host with some never flashes the empty state
                            <Show when={(computersLoaded() || computersLoadFailed()) && props.noComputers}>
                                {(Empty) => {
                                    const View = Empty();
                                    return (
                                        <View
                                            onAdd={() => setIsSetupOpen(true)}
                                            loadFailed={computersLoadFailed()}
                                            onRetryLoad={() => void refreshComputers()}
                                        />
                                    );
                                }}
                            </Show>
                        }
                    >
                    <ComputerRail
                        updateState={appUpdate.state()}
                        showUpdate={nav.railMode() === "home" || (nav.railMode() === "computer" && getSelectedTab(activeComputerId()) === "landing")}
                        onOpenUpdate={() => appUpdate.setOpen(true)}
                        computers={listedComputers()}
                        value={nav.railValue()}
                        onSelect={nav.selectRail}
                        onAdd={() => setIsSetupOpen(true)}
                        onComputerContextMenu={computerDialogs.openMenu}
                        onReorder={(ids) => void computerState.reorderComputers(ids)}
                        loadFailed={computersLoadFailed()}
                        onRetryLoad={() => void refreshComputers()}
                        inert={nav.mobilePageOpen()}
                    />

                    <Show
                        when={nav.railMode() !== "settings"}
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
                                    host={props.hostSettings}
                                    motion={props.motion}
                                    computers={listedComputers()}
                                    loadError={loadError()}
                                    gpu={graphics().gpu}
                                    onRetryLoad={retryLoadAppSettings}
                                />
                            </PaperFlex>
                        }
                    >
                    <ComputerArea
                        computers={computerState}
                        panels={panelState}
                        selection={selection}
                        navigation={nav}
                        restarts={restarts}
                        panelDialogs={panelDialogs}
                        computerDialogs={computerDialogs}
                        theme={theme()}
                        panelName={panelName}
                    />
                    </Show>

                    {/* each layout has its own Home arrangement: a layout change draws the other */}
                    <Show when={props.layout ?? "desktop"} keyed>
                        {(layout) => (
                            <HomeView
                                mobile={layout === "phone"}
                                visible={nav.railMode() === "home"}
                                computers={listedComputers()}
                                panelsByComputer={panelsByComputer()}
                                panelsLoadFailed={panelsLoadFailed()}
                                onRefreshPanels={(compId) => void refreshPanelsForComputer(compId)}
                                onOpenPanel={nav.openComputerTab}
                                onOpenComputer={nav.selectRail}
                                reloadTokens={reloadTokens()}
                            />
                        )}
                    </Show>
                    </Show>
                </PaperFlex>
            </PaperFlex>

            <Show when={mobile()}>
                <PaperSlidePage
                    position="fixed"
                    enabled
                    open={nav.mobileSettingsOpen()}
                    title="Settings"
                    icon="settings"
                    onBack={() => nav.setMobileSettingsOpen(false)}
                >
                    <PaperFlex direction="column" flex={1} minHeight={0} overflowY="auto">
                        <AppSettings
                            compact
                            settings={appSettings()}
                            onChange={handleAppSettingsChange}
                            host={props.hostSettings}
                            motion={props.motion}
                            computers={listedComputers()}
                            loadError={loadError()}
                            gpu={graphics().gpu}
                            onRetryLoad={retryLoadAppSettings}
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

            <Show
                when={props.addComputer}
                fallback={
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
                }
            >
                {(Add) => {
                    const View = Add();
                    return <View open={isSetupOpen()} onClose={() => setIsSetupOpen(false)} />;
                }}
            </Show>

            <panelDialogs.Dialogs />
            <computerDialogs.Dialogs />
        </PaperProvider>
    );
};

export default App;
