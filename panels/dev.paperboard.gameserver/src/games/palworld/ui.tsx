import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import PalworldOverview from "./Overview";
import PalworldPlayers from "./Players";
import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";

export const palworldUI: GameUI = {
    create() {
        return {
            setup: (props) => (
                <SteamSetup
                    name="Palworld"
                    onComplete={props.onComplete}
                />
            ),
            tab(id) {
                switch (id) {
                    case "overview": return <PalworldOverview />;
                    case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                    case "players": return <PalworldPlayers />;
                    case "versions": return <SteamVersions name="Palworld" />;
                    default: throw new Error(`Palworld tab has no renderer: ${id}`);
                }
            },
        };
    },
};
