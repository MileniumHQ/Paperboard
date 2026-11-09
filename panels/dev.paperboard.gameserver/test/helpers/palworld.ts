// What a Palworld server folder holds once SteamCMD installed it: the app
// manifest, the template settings file and the dedicated server, here the
// stand-in fakePalworld.main.ts. SteamCMD is the stand-in too, answering
// that the installed build is the newest, so a start's update check stays
// on this computer.
import * as net from "node:net";
import * as path from "node:path";
import { PALWORLD_APP_ID } from "../../src/games/palworld";
import { placeStandIn } from "./standIn";
import { fakeSteamcmd, STEAM_FIXTURES } from "./steamcmd";
import { writeTree } from "./tmp";

export const PALWORLD_BUILD = "25247047";
// as the dedicated server's install ships it
export const DEFAULT_PALWORLD_INI = [
    "; This configuration file is a sample of the default server settings.",
    "; Changes to this file will NOT be reflected on the server.",
    "[/Script/Pal.PalGameWorldSettings]",
    'OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,ServerName="Default Palworld Server",ServerDescription="Hi, all (friends)",AdminPassword="",ServerPassword="",PublicPort=8211,RCONEnabled=False,RCONPort=25575,RESTAPIEnabled=False,RESTAPIPort=8212,CrossplayPlatforms=(Steam,Xbox,PS5,Mac))',
    "",
].join("\n");

/** a port the OS says is free, for a stand-in to listen on */
export async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

/** installs Palworld into the server folder `dir`; `plan` is the stand-in's fake-palworld.json */
export function installPalworld(dir: string, plan?: Record<string, unknown>): void {
    fakeSteamcmd({ appInfo: { [PALWORLD_APP_ID]: path.join(STEAM_FIXTURES, "palworld-app-info.txt") } });
    writeTree(dir, {
        [`install/steamapps/appmanifest_${PALWORLD_APP_ID}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${PALWORLD_APP_ID}"\n\t"buildid"\t\t"${PALWORLD_BUILD}"\n}\n`,
        "install/DefaultPalWorldSettings.ini": DEFAULT_PALWORLD_INI,
        ...(plan ? { "install/fake-palworld.json": JSON.stringify(plan) } : {}),
    });
    placeStandIn("fakePalworld", path.join(dir, "install", "PalServer.sh"));
}
