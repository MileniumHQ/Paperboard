import { PaperAvatar } from "@mileniumhq/paperui";
import Chat from "../../components/Chat";
import type { GameDefinition } from "../types";
import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import { sourceActions, type SourceGameSpec } from "./index";
import SourceOverview from "./Overview";
import SourcePlayers from "./Players";

export function sourceUI(spec: SourceGameSpec, game: GameDefinition): GameUI {
    const ids = sourceActions(spec.id);
    return {
        create() {
            return {
                setup: (props) => <SteamSetup name={spec.name} infoAction={ids.info} installAction={ids.install} onComplete={props.onComplete} />,
                tab(id) {
                    switch (id) {
                        case "overview": return <SourceOverview spec={spec} game={game} />;
                        case "chat": return <Chat avatar={(name) => <PaperAvatar size="small" shape="square" alt={name} fallbackIcon="person" />} />;
                        case "players": return <SourcePlayers spec={spec} />;
                        case "versions": return <SteamVersions name={spec.name} infoAction={ids.info} installAction={ids.install} />;
                        default: throw new Error(`${spec.name} tab has no renderer: ${id}`);
                    }
                },
            };
        },
    };
}
