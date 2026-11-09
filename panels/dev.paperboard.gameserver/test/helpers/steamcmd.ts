// The stand-in SteamCMD (fakeSteamcmd.main.ts) placed in the panel's SteamCMD
// workspace on the test daemon, so the panel finds SteamCMD installed and
// never asks the daemon to download it.
import * as fs from "node:fs";
import * as path from "node:path";
import { PANEL_ID } from "../../src/servers";
import { placeStandIn } from "./standIn";

export const STEAM_FIXTURES = path.join(import.meta.dir, "..", "fixtures", "steam");

export interface FakeSteamcmdPlan {
    appInfo?: Record<string, string>;
    truncateInfo?: boolean;
    install?: Record<string, { build?: string; mode: "ok" | "missing-config-once" | "fail" | "silent" | "other-app"; reason?: string; files?: Record<string, string> }>;
    selfUpdateOnce?: boolean;
}

export function steamcmdDir(dataDir = process.env.PAPERBOARD_DIR!): string {
    return path.join(dataDir, "files", PANEL_ID, ".steam", "steamcmd");
}

/** places the stand-in (once) and sets what it answers; returns a reader for the runs it saw */
export function fakeSteamcmd(plan: FakeSteamcmdPlan): { runs: () => string[][] } {
    const dir = steamcmdDir();
    const bootstrap = path.join(dir, process.platform === "win32" ? "steamcmd.exe" : "steamcmd.sh");
    if (!fs.existsSync(bootstrap)) placeStandIn("fakeSteamcmd", bootstrap);
    fs.writeFileSync(path.join(dir, "fake-steamcmd.json"), JSON.stringify(plan));
    for (const marker of fs.readdirSync(dir).filter((f) => f.startsWith("."))) fs.rmSync(path.join(dir, marker));
    fs.rmSync(path.join(dir, "runs.log"), { force: true });
    return {
        runs: () => {
            const file = path.join(dir, "runs.log");
            return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
        },
    };
}
