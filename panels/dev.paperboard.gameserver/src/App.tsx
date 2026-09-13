import { createEffect, createSignal, onMount, Show } from "solid-js";
import {
    PaperFlex,
    PaperMenu,
    PaperMenuItem,
    PaperInterfaceGroup,
    PaperInterfaceItem,
} from "@paperboard-dev/paperui";
import { config } from "@paperboard-dev/paperapi";
import { PANEL_ID } from "./service/contract";
import { serverSoftware } from "./lib/server";
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
import "@paperboard-dev/paperui/style.css";
import "./style.css";

export default function App() {
    const [configured, setConfigured] = createSignal<boolean | null>(null);
    const [activeTab, setActiveTab] = createSignal("overview");
    // bumped when the Versions tab asks the Plugins tab to check for updates
    const [pluginUpdateRequest, setPluginUpdateRequest] = createSignal(0);

    // Fabric calls them mods; Vanilla has no plugin system at all
    const pluginKind = () => (serverSoftware() === "fabric" ? "Mods" : "Plugins");
    const hasPluginTab = () => serverSoftware() !== "vanilla";

    createEffect(() => {
        if (!hasPluginTab() && activeTab() === "plugins") {
            setActiveTab("worlds");
        }
    });

    const checkConfig = async () => {
        try {
            const saved = await config.get<any>(PANEL_ID);
            if (saved && typeof saved === "object") {
                setConfigured(Boolean(saved.configured));
            } else {
                setConfigured(false);
            }
        } catch (err) {
            console.debug("[gameserver] saved config unreadable, treating as unconfigured:", String(err));
            setConfigured(false);
        }
    };

    onMount(() => {
        checkConfig();
    });

    return (
        <Show when={configured() !== null}>
            <Show
                when={configured()}
                fallback={<Setup onComplete={() => setConfigured(true)} />}
            >
                <PaperFlex direction="row" fullWidth fullHeight>
                    <PaperMenu
                        name="serverMenu"
                        spacing="half"
                        value={activeTab()}
                        onValueChange={(val) => setActiveTab(String(val))}
                    >
                        <PaperMenuItem value="overview" icon="dashboard">
                            Overview
                        </PaperMenuItem>
                        <PaperMenuItem value="options" icon="tune">
                            Options
                        </PaperMenuItem>
                        <PaperMenuItem value="chat" icon="chat">
                            Chat
                        </PaperMenuItem>
                        <PaperMenuItem value="gamerules" icon="list_alt_check">
                            Game Rules
                        </PaperMenuItem>
                        <PaperMenuItem value="map" icon="map">
                            Map
                        </PaperMenuItem>
                        <PaperMenuItem value="players" icon="group">
                            Players
                        </PaperMenuItem>
                        <PaperMenuItem value="versions" icon="deployed_code">
                            Versions
                        </PaperMenuItem>
                        <Show when={hasPluginTab()}>
                            <PaperMenuItem value="plugins" icon="extension">
                                {pluginKind()}
                            </PaperMenuItem>
                        </Show>
                        <PaperMenuItem value="logs" icon="description">
                            Logs
                        </PaperMenuItem>
                        <PaperMenuItem value="worlds" icon="public">
                            Worlds
                        </PaperMenuItem>
                        <PaperMenuItem value="advanced" icon="settings">
                            Advanced
                        </PaperMenuItem>
                    </PaperMenu>

                    <PaperInterfaceGroup
                        value={activeTab()}
                        style={{ flex: 1, height: "100%", "min-height": 0, overflow: "auto" }}
                    >
                        <PaperInterfaceItem value="overview">
                            <Overview />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="chat">
                            <Chat />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="options">
                            <Options />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="gamerules">
                            <GameRules />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="map">
                            <MapView />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="players">
                            <Players />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="versions">
                            <Versions
                                onRequestPluginUpdate={() => {
                                    setActiveTab("plugins");
                                    setPluginUpdateRequest((n) => n + 1);
                                }}
                            />
                        </PaperInterfaceItem>
                        <Show when={hasPluginTab()}>
                            <PaperInterfaceItem value="plugins">
                                <Plugins updateRequest={pluginUpdateRequest()} />
                            </PaperInterfaceItem>
                        </Show>
                        <PaperInterfaceItem value="logs">
                            <Logs />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="worlds">
                            <Worlds />
                        </PaperInterfaceItem>
                        <PaperInterfaceItem value="advanced">
                            <Advanced />
                        </PaperInterfaceItem>
                    </PaperInterfaceGroup>
                </PaperFlex>
            </Show>
        </Show>
    );
}
