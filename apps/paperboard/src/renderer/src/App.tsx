import { type Component, createSignal, onMount, For, Show } from "solid-js";
import {
    PaperProvider,
    PaperFlex,
    PaperList,
    PaperListItem,
    PaperModal,
    useContextMenuState,
    getVarCss,
} from "@paperboard-dev/paperui";
import {
    panelsApi,
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
import TopBar from "./components/layout/TopBar";
import { useAppSettings } from "./hooks/useAppSettings";

export type { ComputerItem };
const App: Component = () => {
    const [computers, setComputers] = createSignal<ComputerItem[]>([
        {
            id: "local",
            name: "This Computer",
            host: "127.0.0.1",
            port: 45464,
            isLocal: true,
            // Unknown until refreshComputers() probes the daemon
            status: {
                connected: false,
                isRemote: false,
                host: "127.0.0.1",
                port: 45464,
            },
        },
    ]);
    const [activeComputerId, setActiveComputerId] =
        createSignal<string>("local");
    const [panelsByComputer, setPanelsByComputer] = createSignal<
        Record<string, PanelItem[]>
    >({});
    const [activeTabByComputer, setActiveTabByComputer] = createSignal<
        Record<string, string>
    >({
        local: "landing",
    });
    const [storePanels, setStorePanels] = createSignal<PanelItem[]>([]);
    const [isSetupOpen, setIsSetupOpen] = createSignal<boolean>(false);
    const [openedPanels, setOpenedPanels] = createSignal<string[]>([]);
    const [reloadTokens, setReloadTokens] = createSignal<
        Record<string, number>
    >({});
    const panelContextMenu = useContextMenuState();
    const [contextMenuPanel, setContextMenuPanel] = createSignal<{
        compId: string;
        panel: PanelItem;
    } | null>(null);
    const [isUninstallModalOpen, setIsUninstallModalOpen] =
        createSignal<boolean>(false);
    const [uninstallTarget, setUninstallTarget] =
        createSignal<UninstallTarget | null>(null);
    const [isUninstalling, setIsUninstalling] = createSignal<boolean>(false);
    const [uninstallError, setUninstallError] = createSignal<string | null>(
        null,
    );
    const [storeLoadFailed, setStoreLoadFailed] =
        createSignal<boolean>(false);
    const { appSettings, loadAppSettings, handleAppSettingsChange } =
        useAppSettings();
    const [showAppSettings, setShowAppSettings] = createSignal<boolean>(false);
    const [offlineTarget, setOfflineTarget] = createSignal<ComputerItem | null>(
        null,
    );

    const handleRailSelect = (val: string) => {
        if (val === "__settings") {
            setShowAppSettings(true);
        } else {
            setShowAppSettings(false);
            handleComputerSelect(val);
        }
    };

    const handleReloadPanel = () => {
        const target = contextMenuPanel();
        if (!target) return;
        panelContextMenu.close();
        const key = `${target.compId}::${target.panel.id}`;
        setReloadTokens((prev) => ({
            ...prev,
            [key]: (prev[key] || 0) + 1,
        }));
        const iframe = document.querySelector(
            `iframe[data-panel-key="${key}"]`,
        ) as HTMLIFrameElement | null;
        if (iframe) {
            iframe.src = `panel://${target.compId}.${target.panel.id}/?_r=${Date.now()}`;
        }
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

    const getSelectedTab = (compId: string) => {
        return activeTabByComputer()[compId] || "landing";
    };

    const setComputerTab = (compId: string, tab: string) => {
        setActiveTabByComputer((prev) => ({
            ...prev,
            [compId]: tab,
        }));
        if (tab !== "landing" && tab !== "library" && tab !== "settings") {
            const key = `${compId}::${tab}`;
            setOpenedPanels((prev) =>
                prev.includes(key) ? prev : [...prev, key],
            );
        }
    };

    const refreshComputers = async () => {
        try {
            const data = await computersApi.list();
            if (data && Array.isArray(data.computers)) {
                setComputers(data.computers);
                if (data.activeId) {
                    setActiveComputerId(data.activeId);
                }
            }
        } catch {}
    };

    // Fetches always name their computer explicitly — no active-connection races
    const refreshPanelsForComputer = async (compId: string) => {
        try {
            const installed = await panelsApi.list(compId);
            if (Array.isArray(installed)) {
                setPanelsByComputer((prev) => ({
                    ...prev,
                    [compId]: installed,
                }));
            }
        } catch (err) {
            logToMain("error", "Failed to load installed panels for", compId, err);
        }
    };

    const refreshStorePanels = async (compId: string) => {
        try {
            const registry = await panelsApi.registry(compId);
            if (Array.isArray(registry)) {
                setStorePanels(registry);
                setStoreLoadFailed(false);
            }
        } catch (err) {
            logToMain("error", "Failed to load panel store:", err);
            // Library shows a retry affordance instead of an empty grid
            setStoreLoadFailed(true);
        }
    };

    const activePanelsList = () => {
        const installed = panelsByComputer()[activeComputerId()] || [];
        const installedIds = new Set(installed.map((p) => p.id));
        return storePanels().map((panel) => ({
            ...panel,
            isInstalled: installedIds.has(panel.id),
        }));
    };

    const activeComputer = () =>
        computers().find((c) => c.id === activeComputerId()) || computers()[0];

    const handleReconnectSuccess = async () => {
        const compId = activeComputerId();
        await refreshComputers();
        await refreshPanelsForComputer(compId);
        await refreshStorePanels(compId);
    };

    onMount(async () => {
        // Restores the active computer over privileged IPC
        await refreshComputers();

        // Data fetches are scoped per computer
        await refreshPanelsForComputer(activeComputerId());
        refreshStorePanels(activeComputerId());

        // Load application-wide settings before anything depends on them
        await loadAppSettings();

        computersApi.onChanged((data) => {
            if (data && Array.isArray(data.computers)) {
                setComputers(data.computers);
                if (data.activeId) {
                    setActiveComputerId(data.activeId);
                }
            }
        });
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

    const handleRemoveComputer = async (compId: string) => {
        try {
            await computersApi.remove(compId);
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
        } catch (err) {
            logToMain("error", "Failed to remove computer:", err);
        }
    };

    const handleComputerAdded = async (newComp: any) => {
        await refreshComputers();
        if (newComp?.id) {
            await handleComputerSelect(newComp.id);
        }
    };

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
                <TopBar />
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
                            background="definition"
                            style={{
                                width: getVarCss("sidebar-width"),
                                height: "100%",
                                "border-right": `${getVarCss("border-width")} solid ${getVarCss("medium-border")}`,
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
                                                    getVarCss("medium-border"),
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
                                    panels={activePanelsList()}
                                    computerId={activeComputerId()}
                                    loadFailed={storeLoadFailed()}
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
