import type { GameUI } from "../uiTypes";
import TerrariaSetup from "./Setup";
import TerrariaOverview from "./Overview";
import TerrariaWorlds from "./Worlds";
import TerrariaVersions from "./Versions";

export const terrariaUI: GameUI = {
    create() {
        return {
            setup: (props) => <TerrariaSetup onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <TerrariaOverview />;
                    case "worlds": return <TerrariaWorlds />;
                    case "versions": return <TerrariaVersions />;
                    default: throw new Error(`Terraria tab has no renderer: ${id}`);
                }
            },
        };
    },
};
