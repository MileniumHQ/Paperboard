import type { GameUI } from "../uiTypes";
import TerrariaSetup from "./Setup";
import TerrariaOverview from "./Overview";
import TerrariaWorlds from "./Worlds";
import TerrariaVersions from "./Versions";
import TerrariaPlayers, { TerrariaAvatar } from "./Players";
import Chat from "../../components/Chat";

export const terrariaUI: GameUI = {
    create() {
        return {
            setup: (props) => <TerrariaSetup onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <TerrariaOverview />;
                    case "chat": return <Chat avatar={(name) => <TerrariaAvatar name={name} size="small" />} />;
                    case "players": return <TerrariaPlayers />;
                    case "worlds": return <TerrariaWorlds />;
                    case "versions": return <TerrariaVersions />;
                    default: throw new Error(`Terraria tab has no renderer: ${id}`);
                }
            },
        };
    },
};
