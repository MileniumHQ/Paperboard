import { createEffect, createSignal, onMount, onCleanup, Show } from "solid-js";
import {
    PaperPanel, PaperButton, PaperModal, PaperQuote, PaperLoader, PaperFlex, PaperText,
    PaperMenu,
    PaperMenuItem,
    PaperMenuLabel,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@mileniumhq/paperui";
import { serversBridge, selectedServerId, selectedServer, openServer } from "./lib/api";
import { loadServerConfig } from "./lib/server";
import type { ServersState } from "./service";
import ServersHome from "./components/ServersHome";
import { PANEL_ID } from "./service/contract";
import { serverSoftware } from "./lib/server";
import { SOFTWARE } from "./software/catalog";
import { hasKnownMcVersion, supports } from "./lib/capabilities";
import Setup from "./components/Setup";
import Overview from "./components/Overview";
import Chat from "./components/Chat";
import Options from "./components/Options";
import GameRules from "./components/GameRules";
import Players from "./components/Players";
import Plugins from "./components/Plugins";
import Worlds from "./components/Worlds";
import MapView from "./components/Map";
import Advanced from "./components/Advanced";
import Logs from "./components/Logs";
import Versions from "./components/Versions";
import Loader from "./components/Loader";
import Datapacks from "./components/Datapacks";
import ResourcePack from "./components/ResourcePack";
import Crossplay from "./components/Crossplay";
import { CROSSPLAY } from "./software/crossplay";
import Modpacks from "./components/Modpacks";
import { MODPACK_LOADER } from "./core/modpack";
import Files from "./components/Files";
import Backups from "./components/Backups";
import type { PaperFileReveal } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");
    // bumped when the Versions tab asks the Plugins tab to check for updates
    const [pluginUpdateRequest, setPluginUpdateRequest] = createSignal(0);
    // set when a plugin's Configure button asks the Files tab to open its settings
    const [filesReveal, setFilesReveal] = createSignal<PaperFileReveal | null>(null);

    // mod loaders call them mods; Vanilla has no add-on system at all
    const pluginKind = () => (SOFTWARE[serverSoftware()].addons?.kind === "mod" ? "Mods" : "Plugins");
    const hasPluginTab = () => SOFTWARE[serverSoftware()].addons !== null;
    // Vanilla has no loader; its settings are on Options and Advanced
    const hasLoaderTab = () => serverSoftware() !== "vanilla";
    // modpacks are built for one loader: only the loaders that run them show the tab
    const hasModpackTab = () => MODPACK_LOADER[serverSoftware()] !== undefined;
    // Geyser runs on Paper, Fabric and NeoForge only
    const hasCrossplayTab = () => CROSSPLAY[serverSoftware()] !== undefined;

    // whole-feature floors: hide the tab rather than show half its controls
    // doing nothing. Unknown version stays permissive so nothing flashes out
    // before config loads; once known, unsupported features disappear.
    const featureReady = (
        cap: "mapRendering" | "playerStats" | "worldManager" | "datapacks",
    ) => !hasKnownMcVersion() || supports(cap);
    const showMap = () => featureReady("mapRendering");
    const showPlayers = () => featureReady("playerStats");
    const showWorlds = () => featureReady("worldManager");
    const showDatapacks = () => featureReady("datapacks");

    createEffect(() => {
        if (!hasPluginTab() && activeTab() === "plugins") setActiveTab("overview");
        if (!hasModpackTab() && activeTab() === "modpacks") setActiveTab("overview");
        if (!hasCrossplayTab() && activeTab() === "crossplay") setActiveTab("overview");
        if (!showMap() && activeTab() === "map") setActiveTab("overview");
        if (!showPlayers() && activeTab() === "players") setActiveTab("overview");
        if (!showWorlds() && activeTab() === "worlds") setActiveTab("overview");
        if (!showDatapacks() && activeTab() === "datapacks") setActiveTab("overview");
    });

    const [servers, setServers] = createSignal<ServersState | null>(null);
    const [failure, setFailure] = createSignal("");
    const apply = (state: ServersState) => {
        setServers(state);
        if (selectedServerId) setConfigured(selectedServer(state).configured);
    };
    const load = async () => {
        try {
            apply(await serversBridge.refreshState());
            if (selectedServerId) await loadServerConfig();
        } catch (err) { setFailure(err instanceof Error ? err.message : String(err)); }
    };
    onMount(() => {
        const off = serversBridge.onStateChange((_patch, full) => {
            try { apply(full); } catch (err) { setFailure(err instanceof Error ? err.message : String(err)); }
        });
        onCleanup(off);
        void load();
    });

    return (
        <Show when={!failure()} fallback={<PaperQuote variant="danger" title="Servers could not be loaded" role="alert">{failure()}<PaperButton onClick={() => openServer(null)}>Servers</PaperButton></PaperQuote>}>
        <Show when={servers()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading servers" />}>
        <Show when={selectedServerId} fallback={<ServersHome state={servers()!} />}>
        <PaperFlex direction="column" fullWidth fullHeight>
            <PaperFlex direction="row" align="center" gap="half" padding="half">
                <PaperButton variant="text" onClick={() => openServer(null)}>Back to Servers</PaperButton>
                <PaperText>{selectedServer(servers()!).name}</PaperText>
            </PaperFlex>
            <Show
                when={configured()}
                fallback={<ServersHome state={servers()!} />}
            >
                <PaperPanel>
                    <PaperMenu
                        name="serverMenu"
                        value={activeTab()}
                        onValueChange={(val) => setActiveTab(String(val))}
                    >
                        <PaperMenuItem value="overview" icon="dashboard">
                            Overview
                        </PaperMenuItem>
                        <PaperMenuLabel>Play</PaperMenuLabel>
                        <PaperMenuItem value="chat" icon="chat">
                            Chat
                        </PaperMenuItem>
                        <Show when={showPlayers()}>
                            <PaperMenuItem value="players" icon="group">
                                Players
                            </PaperMenuItem>
                        </Show>
                        <Show when={showMap()}>
                            <PaperMenuItem value="map" icon="map">
                                Map
                            </PaperMenuItem>
                        </Show>
                        <Show when={hasCrossplayTab()}>
                            <PaperMenuItem value="crossplay" icon="devices">
                                Crossplay
                            </PaperMenuItem>
                        </Show>
                        <PaperMenuLabel>World</PaperMenuLabel>
                        <Show when={showWorlds()}>
                            <PaperMenuItem value="worlds" icon="public">
                                Worlds
                            </PaperMenuItem>
                        </Show>
                        <PaperMenuItem value="gamerules" icon="list_alt_check">
                            Game Rules
                        </PaperMenuItem>
                        <Show when={showDatapacks()}>
                            <PaperMenuItem value="datapacks" icon="dataset">
                                Datapacks
                            </PaperMenuItem>
                        </Show>
                        <PaperMenuItem value="resourcepack" icon="texture">
                            Resource Pack
                        </PaperMenuItem>
                        <PaperMenuLabel>Software</PaperMenuLabel>
                        <PaperMenuItem value="versions" icon="deployed_code">
                            Versions
                        </PaperMenuItem>
                        <Show when={hasLoaderTab()}>
                            <PaperMenuItem value="loader" icon="settings_applications">
                                Loader
                            </PaperMenuItem>
                        </Show>
                        <Show when={hasPluginTab()}>
                            <PaperMenuItem value="plugins" icon="extension">
                                {pluginKind()}
                            </PaperMenuItem>
                        </Show>
                        <Show when={hasModpackTab()}>
                            <PaperMenuItem value="modpacks" icon="package_2">
                                Modpacks
                            </PaperMenuItem>
                        </Show>
                        <PaperMenuLabel>Server</PaperMenuLabel>
                        <PaperMenuItem value="options" icon="tune">
                            Options
                        </PaperMenuItem>
                        <PaperMenuItem value="files" icon="folder">
                            Files
                        </PaperMenuItem>
                        <PaperMenuItem value="logs" icon="description">
                            Logs
                        </PaperMenuItem>
                        <PaperMenuItem value="backups" icon="backup">
                            Backups
                        </PaperMenuItem>
                        <PaperMenuItem value="advanced" icon="settings">
                            Advanced
                        </PaperMenuItem>
                    </PaperMenu>

                    <PaperInterfaceGroup value={activeTab()}>
                        <PaperInterfaceItem value="overview" variant="fill">
                            <Overview
                                active={activeTab() === "overview"}
                                hasPlayersTab={showPlayers()}
                                onOpenTab={setActiveTab}
                            />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="chat" variant="fill">
                            <Chat />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="options">
                            <Options />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="gamerules">
                            <GameRules />
                        </PaperInterfaceItem>
                        <Show when={showMap()}>
                            <PaperInterfaceItem value="map" variant="full">
                                <MapView />
                            </PaperInterfaceItem>
                        </Show>
                        <Show when={showPlayers()}>
                            <PaperInterfaceItem value="players" variant="fill" width="full">
                                <Players />
                            </PaperInterfaceItem>
                        </Show>
                        <PaperInterfaceItem value="versions">
                            <Versions
                                onRequestPluginUpdate={() => {
                                    setActiveTab("plugins");
                                    setPluginUpdateRequest((n) => n + 1);
                                }}
                            />
                        </PaperInterfaceItem>
                        <Show when={hasLoaderTab()}>
                            <PaperInterfaceItem value="loader">
                                <Loader active={activeTab() === "loader"} />
                            </PaperInterfaceItem>
                        </Show>
                        <Show when={hasPluginTab()}>
                            <PaperInterfaceItem value="plugins">
                                <Plugins
                                    updateRequest={pluginUpdateRequest()}
                                    onConfigure={(reveal) => {
                                        setActiveTab("files");
                                        // a new object each time, so the same plugin can be revealed again
                                        setFilesReveal({ ...reveal });
                                    }}
                                />
                            </PaperInterfaceItem>
                        </Show>
                        <Show when={hasModpackTab()}>
                            <PaperInterfaceItem value="modpacks">
                                <Modpacks active={activeTab() === "modpacks"} />
                            </PaperInterfaceItem>
                        </Show>
                        <Show when={showDatapacks()}>
                            <PaperInterfaceItem value="datapacks">
                                <Datapacks active={activeTab() === "datapacks"} />
                            </PaperInterfaceItem>
                        </Show>
                        <Show when={hasCrossplayTab()}>
                            <PaperInterfaceItem value="crossplay">
                                <Crossplay active={activeTab() === "crossplay"} />
                            </PaperInterfaceItem>
                        </Show>
                        <PaperInterfaceItem value="resourcepack">
                            <ResourcePack active={activeTab() === "resourcepack"} />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="files" variant="fill">
                            <Files reveal={filesReveal()} />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="logs" variant="fill">
                            <Logs />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="backups">
                            <Backups active={activeTab() === "backups"} />
                        </PaperInterfaceItem>
                        <Show when={showWorlds()}>
                            <PaperInterfaceItem value="worlds">
                                <Worlds />
                            </PaperInterfaceItem>
                        </Show>
                        <PaperInterfaceItem value="advanced">
                            <Advanced />
                        </PaperInterfaceItem>
                    </PaperInterfaceGroup>
                </PaperPanel>
            </Show>
            <PaperModal open={configured() === false} title="Set up server" size="large" noPadding onClose={() => openServer(null)}>
                <PaperFlex direction="column" height="panel-height-large" fullWidth>
                    <Setup initialSoftware={selectedServer(servers()!).state.serverSoftware} initialVersion={selectedServer(servers()!).state.serverVersion} onComplete={() => setConfigured(true)} />
                </PaperFlex>
            </PaperModal>
        </PaperFlex>
        </Show>
        </Show>
        </Show>
    );
}
