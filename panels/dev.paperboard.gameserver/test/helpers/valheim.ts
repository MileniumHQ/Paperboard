// What a Valheim server folder holds once SteamCMD installed it: the app
// manifest and the dedicated server, here the stand-in fakeValheim.main.ts.
// SteamCMD is the stand-in too, so a start's update check stays on this computer.
import * as fs from "node:fs";
import * as path from "node:path";
import { VALHEIM_APP_ID } from "../../src/games/valheim";
import { placeStandIn } from "./standIn";
import { fakeSteamcmd, STEAM_FIXTURES } from "./steamcmd";
import { writeTree } from "./tmp";

export const VALHEIM_BUILD = "26949048";

/** installs Valheim into the server folder `dir`; `plan` is the stand-in's fake-valheim.json */
export function installValheim(dir: string, plan?: Record<string, unknown>): void {
    fakeSteamcmd({ appInfo: { [VALHEIM_APP_ID]: path.join(STEAM_FIXTURES, "valheim-app-info.txt") } });
    writeTree(dir, {
        [`install/steamapps/appmanifest_${VALHEIM_APP_ID}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${VALHEIM_APP_ID}"\n\t"buildid"\t\t"${VALHEIM_BUILD}"\n}\n`,
        ...(plan ? { "install/fake-valheim.json": JSON.stringify(plan) } : {}),
    });
    placeStandIn("fakeValheim", path.join(dir, "install", "valheim_server.x86_64"));
}

/** the stand-in prints these as its own lines, without their time, in order */
export function serverSays(dir: string, ...lines: string[]): void {
    fs.appendFileSync(path.join(dir, "install", "fake-valheim-lines.txt"), lines.map((line) => `${line}\n`).join(""));
}
