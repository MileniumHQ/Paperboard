// A Counter-Strike 2 server folder as SteamCMD leaves it, with the stand-in
// server (fakeCs2.main.ts) where the game's binary goes, and its service
// initialized for it.
import * as path from "node:path";
import { gameServer, type GameServer } from "./game";
import { pickCall } from "./serverCall";
import { freePort } from "./palworld";
import { placeStandIn } from "./standIn";
import { fakeSteamcmd, steamcmdDir } from "./steamcmd";
import { writeTree } from "./tmp";
import { CS2 } from "../../src/games/cs2";
import { cs2Service } from "../../src/games/cs2/service";

export async function cs2Server(): Promise<GameServer> {
    const server = gameServer("counter-strike-2", { settings: { port: await freePort() } });
    fakeSteamcmd({});
    // the Steam client library SteamCMD unpacks, which the server loads from its profile
    writeTree(steamcmdDir(), { "linux64/steamclient.so": "steamclient" });
    writeTree(server.dir, {
        [`install/steamapps/appmanifest_${CS2.appId}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${CS2.appId}"\n\t"buildid"\t\t"26598758"\n}\n`,
        "install/game/csgo/maps/de_dust2.vpk": "", "install/game/csgo/maps/de_dust2_vanity.vpk": "", "install/game/csgo/maps/de_inferno.vpk": "",
        "install/game/csgo/maps/lobby_mapveto.vpk": "", "install/game/csgo/maps/graphics_settings.vpk": "", "install/game/csgo/cfg/server.cfg": "// the game's own\n",
    });
    placeStandIn("fakeCs2", path.join(server.dir, "install", "game", "bin", "linuxsteamrt64", "cs2"));
    await server.server.game.initialize(false);
    return server;
}
/** one of the game's calls, made for `server` */
export const cs2Call = async (server: GameServer, id: string, input: unknown = {}) => pickCall(await server.server.game.calls(), id)(server.server, input);
