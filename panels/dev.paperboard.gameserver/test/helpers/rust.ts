// What a Rust server folder holds once SteamCMD installed it: the app
// manifest and the dedicated server, here the stand-in fakeRust.main.ts.
// SteamCMD is the stand-in too, so a start's update check stays on this
// computer. The remote console's port is let through the suite's network
// guard (test/hermetic.ts), which otherwise allows a socket only to a daemon
// a test started.
import * as path from "node:path";
import { RUST_APP_ID } from "../../src/games/rust";
import { exe, placeStandIn } from "./standIn";
import { fakeSteamcmd, STEAM_FIXTURES } from "./steamcmd";
import { writeTree } from "./tmp";

export const RUST_BUILD = "26498655";

/** lets this process open a WebSocket to a loopback port a test's own stand-in listens on */
export function allowLoopbackSocket(port: number): void {
    const allowed: Set<number> | undefined = (globalThis as any)[Symbol.for("paperboard.gameserver.test.daemonPorts")];
    if (!allowed) throw new Error("test/hermetic.ts is not preloaded");
    allowed.add(port);
}

/** installs Rust into the server folder `dir`; `plan` is the stand-in's fake-rust.json */
export function installRust(dir: string, plan?: Record<string, unknown>): void {
    fakeSteamcmd({ appInfo: { [RUST_APP_ID]: path.join(STEAM_FIXTURES, "rust-app-info.txt") } });
    writeTree(dir, {
        [`install/steamapps/appmanifest_${RUST_APP_ID}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${RUST_APP_ID}"\n\t"buildid"\t\t"${RUST_BUILD}"\n}\n`,
        ...(plan ? { "install/fake-rust.json": JSON.stringify(plan) } : {}),
    });
    placeStandIn("fakeRust", path.join(dir, "install", exe("RustDedicated")));
}
