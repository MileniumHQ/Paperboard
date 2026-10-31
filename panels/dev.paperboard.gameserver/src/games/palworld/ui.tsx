import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import PalworldOverview from "./Overview";
import PalworldPlayers from "./Players";

const INFO = "palworld-info";
const INSTALL = "palworld-install";

export const palworldUI: GameUI = {
    create() {
        return {
            setup: (props) => (
                <SteamSetup
                    name="Palworld"
                    description="Paperboard downloads the Palworld dedicated server from Steam, about 5 GB. Palworld recommends 16 GB of memory for a server, and players join on UDP port 8211."
                    infoAction={INFO}
                    installAction={INSTALL}
                    onComplete={props.onComplete}
                />
            ),
            tab(id) {
                switch (id) {
                    case "overview": return <PalworldOverview />;
                    case "players": return <PalworldPlayers />;
                    case "versions": return <SteamVersions name="Palworld" infoAction={INFO} installAction={INSTALL} />;
                    default: throw new Error(`Palworld tab has no renderer: ${id}`);
                }
            },
        };
    },
};
