import { type JSX, createMemo, For, Show } from "solid-js";
import { PaperFlex, PaperSlidePage } from "@mileniumhq/paperui";
import { loadInstalledPanelMedia, panelsApi } from "@mileniumhq/paperapi";
import { readPanelListingFile } from "../../lib/shell";
import { isShellTab } from "../../lib/shellTabs";
import type { AppSettingsData } from "../../lib/appSettings";
import type { useComputers } from "../../hooks/useComputers";
import type { useComputerSelection } from "../../hooks/useComputerSelection";
import type { usePanelRestarts } from "../../hooks/usePanelRestarts";
import type { usePanels } from "../../hooks/usePanels";
import type { useShellNavigation } from "../../hooks/useShellNavigation";
import type { createPanelDialogs } from "../panels/panelDialogs";
import PanelView, { type PanelHeading } from "../panels/PanelView";
import LibraryFrame from "../panels/LibraryFrame";
import type { createComputerDialogs } from "./computerDialogs";
import ComputerSettings from "./ComputerSettings";
import ComputerSidebar from "./ComputerSidebar";
import ConnectionLostOverlay from "./ConnectionLostOverlay";
import LandingView from "./LandingView";
import PanelIcon from "./PanelIcon";
import { computerIcon } from "./computerIcon";
import libraryIcon from "../../assets/PanelLibrary.png";
import iconStyles from "./panelIcon.module.css";
import styles from "./ComputerArea.module.css";

// The active computer: its panel list, and beside it (on a phone, slid in
// over it) the tab it shows. Every layer stays mounted while another one
// shows, so an open panel or the library keeps its frame and comes back as
// it was left.
export default function ComputerArea(props: {
    computers: ReturnType<typeof useComputers>;
    panels: ReturnType<typeof usePanels>;
    selection: ReturnType<typeof useComputerSelection>;
    navigation: ReturnType<typeof useShellNavigation>;
    restarts: ReturnType<typeof usePanelRestarts>;
    panelDialogs: ReturnType<typeof createPanelDialogs>;
    computerDialogs: ReturnType<typeof createComputerDialogs>;
    theme: AppSettingsData["darkMode"];
    panelName: (computerId: string, panelId: string) => string;
}) {
    const activeComputerId = () => props.computers.activeComputerId();
    const activeComputer = () => props.computers.activeComputer();
    const panelsByComputer = () => props.panels.panelsByComputer();
    const getSelectedTab = (compId: string) => props.panels.getSelectedTab(compId);
    const setComputerTab = (compId: string, tab: string) => props.panels.setComputerTab(compId, tab);
    const refreshPanelsForComputer = (compId: string) => props.panels.refreshPanelsForComputer(compId);
    const selectedTab = () => getSelectedTab(activeComputerId());

    // The library runs in an iframe and asks for installs over postMessage;
    // the install path is unchanged — daemon RPC, refresh, open the panel.
    const installFromLibrary = async (panelId: string) => {
        const compId = activeComputerId();
        await panelsApi.install(panelId, compId);
        await refreshPanelsForComputer(compId);
        setComputerTab(compId, panelId);
    };

    // Panels the registry doesn't list still get a full library page: read
    // their own manifest and store/ files through the panel:// surface.
    const libraryMedia = (panelId: string, full: boolean) => {
        const compId = activeComputerId();
        return loadInstalledPanelMedia((path) => readPanelListingFile(compId, panelId, path), full);
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
        // hidden, not unmounted, while Home shows: open panels keep their
        // frames and come back as left
        <PaperFlex
            direction="row"
            fullHeight
            flex={1}
            overflow="hidden"
            class={styles.computerArea}
            hidden={props.navigation.railMode() !== "computer"}
        >
            <Show when={activeComputer() && !activeComputer()?.isLocal && !activeComputer()?.status?.connected}>
                <ConnectionLostOverlay
                    computer={activeComputer()!}
                    onReconnectSuccess={() => void props.selection.reconnected(activeComputerId())}
                />
            </Show>

            <ComputerSidebar
                computers={props.navigation.listedComputers()}
                activeComputerId={activeComputerId()}
                selectedTab={getSelectedTab}
                onSelectTab={setComputerTab}
                onActivateTab={props.navigation.openMobilePage}
                panelsByComputer={panelsByComputer()}
                invalidPanelsByComputer={props.panels.invalidPanelsByComputer()}
                updatingPanels={props.restarts.updatingPanels()}
                switchError={props.selection.switchError()}
                onRetrySwitch={(compId) => void props.selection.connectComputer(compId)}
                panelsLoadError={props.panels.panelsLoadError()}
                onRetryPanels={(compId) => void refreshPanelsForComputer(compId)}
                onPanelContextMenu={props.panelDialogs.openPanelMenu}
                onLibraryContextMenu={props.panelDialogs.openLibraryMenu}
                mobile={props.navigation.mobile()}
                inert={props.navigation.mobilePageOpen()}
            />

            <PaperSlidePage
                position="fixed"
                enabled={props.navigation.mobile()}
                open={props.navigation.mobilePageOpen()}
                title={mobilePageHeading().title}
                icon={mobilePageHeading().icon}
                onBack={() => props.navigation.setMobilePageOpen(false)}
            >
                <PaperFlex direction="column" fullHeight flex={1} overflow="hidden" class={styles.computerArea}>
                    <For each={props.navigation.listedComputers()}>
                        {(comp) => (
                            <PaperFlex
                                direction="column"
                                fullHeight
                                flex={1}
                                overflow="hidden"
                                hidden={!(activeComputerId() === comp.id && getSelectedTab(comp.id) === "landing")}
                            >
                                <LandingView computer={comp} panelCount={panelsByComputer()[comp.id]?.length} />
                            </PaperFlex>
                        )}
                    </For>

                    <PaperFlex
                        direction="column"
                        fullHeight
                        overflow="hidden"
                        class={styles.frameLayer}
                        classList={{ [styles.away]: selectedTab() !== "library" }}
                    >
                        <LibraryFrame
                            active={selectedTab() === "library"}
                            theme={props.theme}
                            installed={panelsByComputer()[activeComputerId()] || []}
                            onInstall={installFromLibrary}
                            onOpen={(panelId) => setComputerTab(activeComputerId(), panelId)}
                            loadMedia={libraryMedia}
                            reloadToken={props.panelDialogs.libraryReloadToken()}
                            onReload={props.panelDialogs.reloadLibrary}
                        />
                    </PaperFlex>

                    <For each={props.navigation.listedComputers()}>
                        {(comp) => (
                            <PaperFlex
                                direction="column"
                                fullHeight
                                flex={1}
                                overflowY="auto"
                                hidden={!(activeComputerId() === comp.id && getSelectedTab(comp.id) === "settings")}
                            >
                                <ComputerSettings
                                    computer={comp}
                                    shown={
                                        props.navigation.railMode() === "computer" &&
                                        activeComputerId() === comp.id &&
                                        getSelectedTab(comp.id) === "settings" &&
                                        (!props.navigation.mobile() || props.navigation.mobilePageOpen())
                                    }
                                    onForget={() => void props.computerDialogs.openForget(comp.id)}
                                    onChangeName={() => props.computerDialogs.openRename(comp.id)}
                                />
                            </PaperFlex>
                        )}
                    </For>

                    {/* like the library layer: never tear down a live
                        panel iframe on a tab switch */}
                    <PaperFlex
                        direction="column"
                        fullHeight
                        overflow="hidden"
                        class={styles.frameLayer}
                        classList={{ [styles.away]: isShellTab(selectedTab()) }}
                    >
                        {/* a frame is told mobile mode as it loads, so it waits for the launch options */}
                        <Show when={props.navigation.layoutKnown()}>
                            <PanelView
                                panelHeading={panelHeading}
                                mobile={props.navigation.mobile()}
                                activePanel={selectedTab()}
                                activeComputerId={activeComputerId()}
                                computerName={(id) => props.computers.computers().find((c) => c.id === id)?.name || "This Computer"}
                                openedPanels={props.panels.openedPanels()}
                                reloadTokens={props.panels.reloadTokens()}
                                onReloadPanel={props.restarts.bumpReloadToken}
                                restartStates={props.restarts.restartStates()}
                                onPanelFailed={(key) => void refreshPanelsForComputer(key.split("::")[0])}
                                onRestartPanel={(key) => {
                                    const [compId, panelId] = key.split("::");
                                    void props.restarts.restartPanel(compId, panelId, props.panelName(compId, panelId));
                                }}
                            />
                        </Show>
                    </PaperFlex>
                </PaperFlex>
            </PaperSlidePage>
        </PaperFlex>
    );
}
