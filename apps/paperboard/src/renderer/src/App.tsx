import { type Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import {
    PaperProvider,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperModal,
    PaperButton,
    PaperText,
    useContextMenuState,
    getVarCss,
} from "@mileniumhq/paperui";
import {
    loadInstalledPanelMedia,
    panelsApi,
    type PanelItem,
} from "@mileniumhq/paperapi";
import {
    computersApi,
    logToMain,
    panelUrl,
    readPanelListingFile,
    type ComputerInfo as ComputerItem,
} from "./lib/shell";
import AppSettings from "./components/settings/AppSettings";
import PanelView from "./components/panels/PanelView";
import LibraryFrame from "./components/panels/LibraryFrame";
import PanelContextMenu from "./components/panels/PanelContextMenu";
import LibraryContextMenu from "./components/panels/LibraryContextMenu";
import type { RestartState } from "./components/panels/PanelView";
import UninstallPanelModal, {
    type UninstallTarget,
} from "./components/panels/UninstallPanelModal";
import LandingView from "./components/computer/LandingView";
import ComputerSetupWizard from "./components/wizard/ComputerSetupWizard";
import ComputerHeader from "./components/computer/ComputerHeader";
import ComputerSettings from "./components/computer/ComputerSettings";
import ConnectionLostOverlay from "./components/computer/ConnectionLostOverlay";
import OfflineComputerModal from "./components/computer/OfflineComputerModal";
import ComputerRail from "./components/computer/ComputerRail";
import ComputerContextMenu from "./components/computer/ComputerContextMenu";
import AppUpdateModal from "./components/layout/AppUpdateModal";
import { useAppUpdate } from "./hooks/useAppUpdate";
import TopBar from "./components/layout/TopBar";
import { useAppSettings } from "./hooks/useAppSettings";
import { useComputers } from "./hooks/useComputers";
import { usePanels } from "./hooks/usePanels";

export type { ComputerItem };
const App: Component = () => {
    const appUpdate = useAppUpdate();
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
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
    } = usePanels();
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
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
    const { appSettings, loadAppSettings, handleAppSettingsChange } =
        useAppSettings();
    const [showAppSettings, setShowAppSettings] = createSignal<boolean>(false);

    const handleRailSelect = (val: string) => {
        if (val === "__settings") {
            setShowAppSettings(true);
        } else {
            setShowAppSettings(false);
            handleComputerSelect(val);
        }
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
        // Restores the active computer over privileged IPC
        await refreshComputers();

        // Data fetches are scoped per computer
        await refreshPanelsForComputer(activeComputerId());

        // Load application-wide settings before anything depends on them
        await loadAppSettings();

        // Launch always lands on the splash, never on a panel: opening the
        // last-used panel on boot made a misbehaving panel the first thing
        // the user saw, with no deliberate action to blame.

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

        // UI restore only; fetches below name the computer explicitly
        computersApi
            .switch(compId)
            .then(async () => {
                await refreshPanelsForComputer(compId);
            })
            .catch((err) => {
                logToMain("error", "Failed to switch computer:", err);
            });
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
        const style = {
            width: getVarCss("icon-size-large"),
            height: getVarCss("icon-size-large"),
            "border-radius": getVarCss("border-radius-half"),
            "object-fit": "contain" as const,
        };
        if (panel.iconUrl) {
            return <img src={panel.iconUrl} alt={panel.name} style={style} />;
        }
        if (panel.icon?.includes(".")) {
            return (
                <img
                    src={panelUrl(compId, panel.id, panel.icon)}
                    alt={panel.name}
                    style={style}
                />
            );
        }
        return panel.icon || "dashboard";
    };

    return (
        <PaperProvider
            theme={appSettings().darkMode}
            styleBody
            unselectable
        >
            <PaperFlex
                direction="column"
                style={{ width: "100vw", height: "100vh", overflow: "hidden" }}
            >
                <TopBar
                    updateState={appUpdate.state()}
                    onOpenUpdate={() => appUpdate.setOpen(true)}
                    getComputerId={activeComputerId}
                    getSelectedTab={() => getSelectedTab(activeComputerId())}
                />
                <PaperFlex
                    direction="row"
                    style={{
                        flex: 1,
                        height: "calc(100vh - 38px)",
                        overflow: "hidden",
                    }}
                >
                    <ComputerRail
                        updateState={appUpdate.state()}
                        showUpdate={!showAppSettings() && getSelectedTab(activeComputerId()) === "landing"}
                        onOpenUpdate={() => appUpdate.setOpen(true)}
                        computers={computers()}
                        value={
                            showAppSettings()
                                ? "__settings"
                                : activeComputerId()
                        }
                        onSelect={(val) => handleRailSelect(val)}
                        onAdd={() => setIsSetupOpen(true)}
                        onComputerContextMenu={handleComputerContextMenu}
                        loadFailed={computersLoadFailed()}
                        onRetryLoad={() => void refreshComputers()}
                    />

                    <Show
                        when={!showAppSettings()}
                        fallback={
                            <PaperFlex
                                direction="column"
                                fullWidth
                                fullHeight
                                style={{
                                    flex: 1,
                                    "overflow-y": "auto",
                                }}
                            >
                                <AppSettings
                                    settings={appSettings()}
                                    onChange={handleAppSettingsChange}
                                />
                            </PaperFlex>
                        }
                    >
                    <PaperFlex
                        direction="row"
                        fullHeight
                        style={{
                            flex: 1,
                            overflow: "hidden",
                            position: "relative",
                        }}
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
                            style={{
                                width: getVarCss("size-sidebar"),
                                height: "100%",
                                "border-right": `${getVarCss("border-width")} solid ${getVarCss("border")}`,
                                "flex-shrink": 0,
                                overflow: "hidden",
                            }}
                        >
                            <For each={computers()}>
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
                                            style={{
                                                display: isActive()
                                                    ? "flex"
                                                    : "none",
                                                overflow: "hidden",
                                                background:
                                                    getVarCss("border"),
                                            }}
                                        >
                                            <ComputerHeader
                                                computer={comp}
                                                selectedTab={compTab()}
                                                onSelectTab={(tab) =>
                                                    setComputerTab(comp.id, tab)
                                                }
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
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    "border-right": "none",
                                                    flex: 1,
                                                    "overflow-y": "auto",
                                                }}
                                            >
                                                <For each={compPanels()}>
                                                    {(panel) => (
                                                        <PaperListItem
                                                            value={panel.id}
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
                                                <Show
                                                    when={
                                                        panelsLoadFailed()[comp.id] &&
                                                        compPanels().length === 0
                                                    }
                                                >
                                                    <PaperFlex
                                                        direction="column"
                                                        gap="half"
                                                        style={{
                                                            padding: "12px",
                                                            "align-items": "flex-start",
                                                        }}
                                                    >
                                                        <PaperText size={1} color="text-subtle">
                                                            Couldn't load panels for this computer.
                                                        </PaperText>
                                                        <PaperButton size="tiny"
                                                            variant="text"
                                                            onClick={() =>
                                                                void refreshPanelsForComputer(
                                                                    comp.id,
                                                                )
                                                            }>
                                                            Retry
                                                        </PaperButton>
                                                    </PaperFlex>
                                                </Show>
                                            </PaperList>
                                        </PaperFlex>
                                    );
                                }}
                            </For>
                        </PaperFlex>

                        <PaperFlex
                            direction="column"
                            fullHeight
                            style={{
                                flex: 1,
                                overflow: "hidden",
                                position: "relative",
                            }}
                        >
                            <For each={computers()}>
                                {(comp) => {
                                    const isVisible = () =>
                                        activeComputerId() === comp.id &&
                                        getSelectedTab(comp.id) === "landing";
                                    return (
                                        <PaperFlex
                                            direction="column"
                                            fullHeight
                                            style={{
                                                flex: 1,
                                                overflow: "hidden",
                                                display: isVisible()
                                                    ? "flex"
                                                    : "none",
                                            }}
                                        >
                                            <LandingView computer={comp} />
                                        </PaperFlex>
                                    );
                                }}
                            </For>

                            <PaperFlex
                                direction="column"
                                fullHeight
                                style={{
                                    position: "absolute",
                                    inset: "0",
                                    overflow: "hidden",
                                    display: "flex",
                                    // visibility, not display: a hidden iframe
                                    // keeps its compositor state, so switching
                                    // back does not repaint a white frame
                                    visibility:
                                        getSelectedTab(activeComputerId()) ===
                                        "library"
                                            ? "visible"
                                            : "hidden",
                                    "pointer-events":
                                        getSelectedTab(activeComputerId()) ===
                                        "library"
                                            ? "auto"
                                            : "none",
                                }}
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

                            <For each={computers()}>
                                {(comp) => {
                                    const isVisible = () =>
                                        activeComputerId() === comp.id &&
                                        getSelectedTab(comp.id) === "settings";
                                    return (
                                        <PaperFlex
                                            direction="column"
                                            fullHeight
                                            style={{
                                                flex: 1,
                                                "overflow-y": "auto",
                                                display: isVisible()
                                                    ? "flex"
                                                    : "none",
                                            }}
                                        >
                                            <ComputerSettings
                                                computer={comp}
                                                onRemove={handleRemoveComputer}
                                            />
                                        </PaperFlex>
                                    );
                                }}
                            </For>

                            <PaperFlex
                                direction="column"
                                fullHeight
                                style={{
                                    position: "absolute",
                                    inset: "0",
                                    overflow: "hidden",
                                    display: "flex",
                                    // visibility, not display, for the same
                                    // reason as the library layer: never tear
                                    // down a live panel iframe on a tab switch
                                    visibility:
                                        getSelectedTab(activeComputerId()) !==
                                            "landing" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "library" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "settings"
                                            ? "visible"
                                            : "hidden",
                                    "pointer-events":
                                        getSelectedTab(activeComputerId()) !==
                                            "landing" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "library" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "settings"
                                            ? "auto"
                                            : "none",
                                }}
                            >
                                <PanelView
                                    activePanel={getSelectedTab(
                                        activeComputerId(),
                                    )}
                                    activeComputerId={activeComputerId()}
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
                    </PaperFlex>
                    </Show>
                </PaperFlex>
            </PaperFlex>

            <AppUpdateModal state={appUpdate.state()} open={appUpdate.open()} onClose={() => appUpdate.setOpen(false)} />

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
                size="large"
            >
                <Show when={isSetupOpen()}>
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
                    <PaperFlex
                        direction="row"
                        justify="flex-end"
                        gap="half"
                        fullWidth
                    >
                        <PaperButton
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
                    </PaperFlex>
                }
            >
                <PaperText preset="body">
                    Are you sure you want to forget{" "}
                    <strong>{forgetTargetName()}</strong>?
                </PaperText>
                <Show when={forgetError()}>
                    <PaperText size={2} color="danger">
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
