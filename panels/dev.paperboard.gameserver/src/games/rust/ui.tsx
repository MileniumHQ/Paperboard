import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import RustOverview from "./Overview";
import RustPlayers from "./Players";
import RustMap from "./Map";
import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";

export const rustUI: GameUI = {
    create(ctx) {
        return {
            setup: (props) => <SteamSetup name="Rust" onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <RustOverview />;
                    case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                    case "players": return <RustPlayers />;
                    case "map": return <RustMap active={ctx.active() === id} />;
                    case "versions": return <SteamVersions name="Rust" />;
                    default: throw new Error(`Rust tab has no renderer: ${id}`);
                }
            },
        };
    },
};
