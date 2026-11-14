import { type Component, createSignal, Show } from "solid-js";
import { PaperProvider, PaperFlex, PaperModal, PaperSlidePage } from "@mileniumhq/paperui";
import { isBrowserShell } from "./lib/shell";
import AppSettings from "./components/settings/AppSettings";
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
import MobileWelcome from "./components/computer/MobileWelcome";
import styles from "./App.module.css";
import { useAppSettings } from "./hooks/useAppSettings";
import { useComputers } from "./hooks/useComputers";
import { useComputerSelection } from "./hooks/useComputerSelection";
import { usePanels } from "./hooks/usePanels";
import { usePanelRestarts } from "./hooks/usePanelRestarts";
import { useShellNavigation } from "./hooks/useShellNavigation";
import { useStartUp } from "./hooks/useStartUp";

const App: Component = () => {
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
    const settings = useAppSettings();
    const { appSettings, graphics, handleAppSettingsChange, settingsFailure, retryLoadAppSettings, dismissSettingsFailure } = settings;
    const selection = useComputerSelection({
        computers: computerState,
        panels: panelState,
        appSettings,
        onAppSettingsChange: handleAppSettingsChange,
    });
    const nav = useShellNavigation({ computers: computerState, panels: panelState, selection, panelName });
    const { mobile, listedComputers } = nav;
    useStartUp({ computers: computerState, panels: panelState, settings, navigation: nav });

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
        !mobile() ||
        pendingUpdates(updateQueue.state()).length > 0 ||
        updateQueue.state().holds.length > 0 ||
        appUpdate.state().status === "ready";

    return (
        <PaperProvider
            theme={appSettings().darkMode}
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
                        when={!nav.mobileWelcome()}
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
                                    computers={listedComputers()}
                                    failure={settingsFailure()}
                                    gpu={graphics().gpu}
                                    onRetryLoad={() => void retryLoadAppSettings()}
                                    onDismissFailure={dismissSettingsFailure}
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
                        theme={appSettings().darkMode}
                        panelName={panelName}
                    />
                    </Show>

                    <Show when={nav.layoutKnown()}>
                    <HomeView
                        mobile={mobile()}
                        visible={nav.railMode() === "home"}
                        computers={listedComputers()}
                        panelsByComputer={panelsByComputer()}
                        panelsLoadFailed={panelsLoadFailed()}
                        onRefreshPanels={(compId) => void refreshPanelsForComputer(compId)}
                        onOpenPanel={nav.openComputerTab}
                        onOpenComputer={nav.selectRail}
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
