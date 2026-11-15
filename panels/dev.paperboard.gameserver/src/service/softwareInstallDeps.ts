import type { Server } from "./server";
import { files as fileApi, readSettings } from "./api";
import { updatePanelConfig } from "../games/minecraft/config";
import { ensureJavaFor } from "../games/minecraft/java";
import { runInstallerProcess, stopLeftoverInstaller } from "./installerProcess";
import type { InstallDeps } from "../games/minecraft/softwareInstall";
import { PANEL_ID, type GameServerState } from "./types";


const serverDir = () => fileApi.getPath("", PANEL_ID);

/** The daemon-backed dependencies of installServerSoftware. */
export function liveInstallDeps(ctx: Server): InstallDeps {
    return {
        serverDir,
        download: (opts) => fileApi.download({ ...opts, appId: PANEL_ID }),
        javaBinary: ensureJavaFor,
        runInstaller: (run) => runInstallerProcess(run),
        readConfig: readSettings,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}

export function liveRecoveryDeps() {
    return { serverDir, readConfig: readSettings, stopLeftoverInstaller: () => stopLeftoverInstaller() };
}
