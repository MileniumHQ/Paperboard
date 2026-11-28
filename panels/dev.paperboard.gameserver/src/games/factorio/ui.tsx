import type { GameUI } from "../uiTypes";
import FactorioSetup from "./Setup";
import FactorioOverview from "./Overview";
import FactorioPlayers from "./Players";
import FactorioWorlds from "./Worlds";
import FactorioVersions from "./Versions";
import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";

export const factorioUI: GameUI = {
    create() {
        return {
            setup: (props) => <FactorioSetup onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <FactorioOverview />;
                    case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                    case "players": return <FactorioPlayers />;
                    case "worlds": return <FactorioWorlds />;
                    case "versions": return <FactorioVersions />;
                    default: throw new Error(`Factorio tab has no renderer: ${id}`);
                }
            },
        };
    },
};
