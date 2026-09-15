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
} from "@paperboard-dev/paperui";
import {
    panelsApi,
    config,
    type PanelItem,
} from "@paperboard-dev/paperapi";
import {
    computersApi,
    logToMain,
    type ComputerInfo as ComputerItem,
} from "./lib/shell";
import AppSettings from "./components/settings/AppSettings";
import PanelView from "./components/panels/PanelView";
import PanelLibrary from "./components/panels/PanelLibrary";
import PanelContextMenu from "./components/panels/PanelContextMenu";
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
import TopBar from "./components/layout/TopBar";
import { useAppSettings } from "./hooks/useAppSettings";
import { useComputers } from "./hooks/useComputers";
import { usePanels, LAST_OPENED_ID } from "./hooks/usePanels";

export type { ComputerItem };
const App: Component = () => {
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
        storeLoadFailedFor,
        panelsLoadFailed,
        getSelectedTab,
        setComputerTab,
        refreshPanelsForComputer,
        refreshStorePanels,
        activePanelsList,
    } = usePanels();
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
    const panelContextMenu = useContextMenuState();
    const [contextMenuPanel, setContextMenuPanel] = createSignal<{
        compId: string;
        panel: PanelItem;
    } | null>(null);
    const computerContextMenu = useContextMenuState();
    const [contextMenuComputerId, setContextMenuComputerId] = createSignal<string | null>(null);
    const [isForgetConfirmOpen, setIsForgetConfirmOpen] = createSignal(false);
    const [isForgetting, setIsForgetting] = createSignal(false);
    const [forgetError, setForgetError] = createSignal<string | null>(null);
    const [isUninstallModalOpen, setIsUninstallModalOpen] =
        createSignal<boolean>(false);
    const [uninstallTarget, setUninstallTarget] =
        createSignal<UninstallTarget | null>(null);
    const [isUninstalling, setIsUninstalling] = createSignal<boolean>(false);
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

    const handleReloadPanel = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        const key = `${target.compId}::${target.panel.id}`;
        bumpReloadToken(key);
    };

    const handleRequestUninstall = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        setUninstallTarget(target);
        setIsUninstallModalOpen(true);
    };

    const handleConfirmUninstall = async () => {
        const target = uninstallTarget();
        if (!target || isUninstalling()) return;
        setIsUninstalling(true);
        setUninstallError(null);
        try {
            await panelsApi.uninstall(target.panel.id, target.compId);
            const key = `${target.compId}::${target.panel.id}`;
            setOpenedPanels((prev) => prev.filter((k) => k !== key));
            if (getSelectedTab(target.compId) === target.panel.id) {
                setComputerTab(target.compId, "landing");
            }
            await refreshPanelsForComputer(target.compId);
            await refreshStorePanels(target.compId);
            setIsUninstallModalOpen(false);
            setUninstallTarget(null);
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
        await refreshStorePanels(compId);
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
        refreshStorePanels(activeComputerId());

        // Load application-wide settings before anything depends on them
        await loadAppSettings();

        // Honor the default panel on local: a pinned panel, else the
        // persisted last-opened panel, else the first installed panel.
        const localPanels = panelsByComputer()["local"] || [];
        const def =
            appSettings().defaultPanel &&
            appSettings().defaultPanel !== "last"
                ? appSettings().defaultPanel
                : null;
        if (def && localPanels.some((p) => p.id === def)) {
            setComputerTab("local", def);
        } else {
            let target: string | null = null;
            try {
                const last = await config.get<{ panelId?: string }>(
                    LAST_OPENED_ID,
                );
                if (
                    last?.panelId &&
                    localPanels.some((p) => p.id === last.panelId)
                ) {
                    target = last.panelId;
                }
            } catch (err) { console.error("[App] op failed:", err); }
            if (!target && localPanels.length > 0) {
                target = localPanels[0].id;
            }
            if (target) setComputerTab("local", target);
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

        // UI restore only; fetches below name the computer explicitly
        computersApi
            .switch(compId)
            .then(async () => {
                await refreshPanelsForComputer(compId);
                // The store is per-computer too — re-merge against the new target
                await refreshStorePanels(compId);
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

    const handleDownload = async (panelId: string) => {
        const compId = activeComputerId();
        await panelsApi.install(panelId, compId);
        await refreshPanelsForComputer(compId);
        setComputerTab(compId, panelId);
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
                    src={`panel://${compId}.${panel.id}/${panel.icon.replace(/^\.\//, "")}`}
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
                            >
                                <AppSettings
                                    settings={appSettings()}
                                    onChange={handleAppSettingsChange}
                                    panels={(panelsByComputer()["local"] || []).map(
                                        (p) => ({ id: p.id, name: p.name }),
                                    )}
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
                                    flex: 1,
                                    overflow: "hidden",
                                    display:
                                        getSelectedTab(activeComputerId()) ===
                                        "library"
                                            ? "flex"
                                            : "none",
                                }}
                            >
                                <PanelLibrary
                                    panels={activePanelsList(activeComputerId())}
                                    computerId={activeComputerId()}
                                    loadFailed={storeLoadFailedFor(activeComputerId())}
                                    onRetryLoad={() =>
                                        void refreshStorePanels(
                                            activeComputerId(),
                                        )
                                    }
                                    onOpen={(id) =>
                                        setComputerTab(activeComputerId(), id)
                                    }
                                    onDownload={handleDownload}
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
                                                overflow: "hidden",
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
                                    flex: 1,
                                    position: "relative",
                                    overflow: "hidden",
                                    display:
                                        getSelectedTab(activeComputerId()) !==
                                            "landing" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "library" &&
                                        getSelectedTab(activeComputerId()) !==
                                            "settings"
                                            ? "flex"
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
                                />
                            </PaperFlex>
                        </PaperFlex>
                    </PaperFlex>
                    </Show>
                </PaperFlex>
            </PaperFlex>

            <OfflineComputerModal
                open={!!offlineTarget()}
                computer={offlineTarget() ?? undefined}
                onClose={() => setOfflineTarget(null)}
                onWorkOffline={() => {
                    const comp = offlineTarget();
                    if (!comp) return;
                    setOfflineTarget(null);
                    finishComputerSelect(comp.id);
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
                onReload={handleReloadPanel}
                onUninstall={handleRequestUninstall}
            />

            <ComputerContextMenu
                menu={computerContextMenu}
                onForget={handleForgetFromMenu}
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
                onClose={() => {
                    if (!isUninstalling()) {
                        setIsUninstallModalOpen(false);
                        setUninstallTarget(null);
                        setUninstallError(null);
                    }
                }}
                onConfirm={handleConfirmUninstall}
            />
        </PaperProvider>
    );
};

export default App;
