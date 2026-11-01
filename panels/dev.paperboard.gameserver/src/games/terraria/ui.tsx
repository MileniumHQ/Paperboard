import type { GameUI } from "../uiTypes";
import TerrariaSetup from "./Setup";
import TerrariaOverview from "./Overview";
import TerrariaWorlds from "./Worlds";
import TerrariaVersions from "./Versions";
import TerrariaMods from "./Mods";
import TerrariaPlayers from "./Players";
import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";

export const terrariaUI: GameUI = {
    create(ctx) {
        return {
            setup: (props) => <TerrariaSetup onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <TerrariaOverview />;
                    case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                    case "players": return <TerrariaPlayers />;
                    case "worlds": return <TerrariaWorlds />;
                    case "versions": return <TerrariaVersions />;
                    case "mods": return <TerrariaMods active={ctx.active() === id} />;
                    default: throw new Error(`Terraria tab has no renderer: ${id}`);
                }
            },
        };
    },
};
