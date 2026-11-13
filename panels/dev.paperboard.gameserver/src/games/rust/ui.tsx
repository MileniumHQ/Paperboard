import type { GameUI } from "../uiTypes";
import SteamSetup from "../steam/SteamSetup";
import SteamVersions from "../steam/SteamVersions";
import RustOverview from "./Overview";
import RustPlayers from "./Players";
import Chat from "../../components/Chat";
import PlayerAvatar from "../../components/PlayerAvatar";

const INFO = "rust-info";
const LATEST = "rust-latest";
const INSTALL = "rust-install";

export const rustUI: GameUI = {
    create() {
        return {
            setup: (props) => <SteamSetup name="Rust" infoAction={INFO} installAction={INSTALL} onComplete={props.onComplete} />,
            tab(id) {
                switch (id) {
                    case "overview": return <RustOverview />;
                    case "chat": return <Chat avatar={(name) => <PlayerAvatar name={name} size="small" />} />;
                    case "players": return <RustPlayers />;
                    case "versions": return <SteamVersions name="Rust" infoAction={INFO} latestAction={LATEST} installAction={INSTALL} />;
                    default: throw new Error(`Rust tab has no renderer: ${id}`);
                }
            },
        };
    },
};
