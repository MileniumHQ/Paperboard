import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import ValheimOverview from "./Overview";
import ValheimPlayers from "./Players";

export const valheimUI: GameUI = {
    create() {
        return {
            setup: (props) => <SteamSetup name="Valheim" onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <ValheimOverview />;
                    case "players": return <ValheimPlayers />;
                    case "versions": return <SteamVersions name="Valheim" />;
                    default: throw new Error(`Valheim tab has no renderer: ${id}`);
                }
            },
        };
    },
};
