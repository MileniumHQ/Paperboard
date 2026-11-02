import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";
import type { GameDefinition } from "../types";
import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import { sourceActions, type SourceGameSpec } from "./index";
import SourceOverview from "./Overview";
import SourcePlayers from "./Players";
import SourceMods from "./Mods";

export function sourceUI(spec: SourceGameSpec, game: GameDefinition): GameUI {
    const ids = sourceActions(spec.id);
    return {
        create(ctx) {
            return {
                setup: (props) => <SteamSetup name={spec.name} infoAction={ids.info} installAction={ids.install} onComplete={props.onComplete} />,
                tab(id) {
                    switch (id) {
                        case "overview": return <SourceOverview spec={spec} game={game} />;
                        case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                        case "players": return <SourcePlayers spec={spec} />;
                        case "versions": return <SteamVersions name={spec.name} infoAction={ids.info} latestAction={ids.latest} installAction={ids.install} />;
                        case "mods": return <SourceMods spec={spec} active={ctx.active() === id} />;
                        default: throw new Error(`${spec.name} tab has no renderer: ${id}`);
                    }
                },
            };
        },
    };
}
