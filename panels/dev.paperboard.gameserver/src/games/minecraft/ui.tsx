import { createSignal } from "solid-js";
import type { GameUI } from "../uiTypes";
import { minecraftSoftware } from "./index";
import Setup from "../../components/Setup";
import Overview from "../../components/Overview";
import Chat from "../../components/Chat";
import PlayerHead from "../../components/PlayerHead";
import Options from "../../components/Options";
import GameRules from "../../components/GameRules";
import Players from "../../components/Players";
import Plugins from "../../components/Plugins";
import Worlds from "../../components/Worlds";
import MapView from "../../components/Map";
import Advanced from "../../components/Advanced";
import Versions from "../../components/Versions";
import Loader from "../../components/Loader";
import Datapacks from "../../components/Datapacks";
import ResourcePack from "../../components/ResourcePack";
import Crossplay from "../../components/Crossplay";
import Modpacks from "../../components/Modpacks";

/** Existing components and props; only their ownership and lookup change. */
export const minecraftUI: GameUI = {
    create(ctx) {
        const [pluginUpdateRequest, setPluginUpdateRequest] = createSignal(0);
        const requestPluginUpdate = () => { ctx.openTab("plugins"); setPluginUpdateRequest((n) => n + 1); };
        return {
            setup: (props) => <Setup initialSoftware={minecraftSoftware(props.initialSoftware)} initialVersion={props.initialVersion} onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <Overview active={ctx.active() === id} hasPlayersTab={ctx.hasTab("players")} onOpenTab={ctx.openTab} />;
                    case "chat": return <Chat avatar={(name) => <PlayerHead name={name} alt={name} size="small" />} />;
                    case "options": return <Options />;
                    case "gamerules": return <GameRules />;
                    case "players": return <Players />;
                    case "worlds": return <Worlds />;
                    case "map": return <MapView />;
                    case "advanced": return <Advanced />;
                    case "versions": return <Versions onRequestPluginUpdate={requestPluginUpdate} />;
                    case "loader": return <Loader active={ctx.active() === id} />;
                    case "plugins": return <Plugins updateRequest={pluginUpdateRequest()} onConfigure={ctx.revealFiles} />;
                    case "datapacks": return <Datapacks active={ctx.active() === id} />;
                    case "resourcepack": return <ResourcePack active={ctx.active() === id} />;
                    case "crossplay": return <Crossplay active={ctx.active() === id} />;
                    case "modpacks": return <Modpacks active={ctx.active() === id} />;
                    default: throw new Error(`Minecraft tab has no renderer: ${id}`);
                }
            },
        };
    },
};
