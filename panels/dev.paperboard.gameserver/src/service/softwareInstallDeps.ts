import type { Server } from "./server";

import { updatePanelConfig } from "../games/minecraft/config";
import { ensureJavaFor } from "../games/minecraft/java";
import { runInstallerProcess, stopLeftoverInstaller } from "./installerProcess";
import type { InstallDeps } from "../games/minecraft/softwareInstall";
import { PANEL_ID } from "./types";


/** The daemon-backed dependencies of installServerSoftware. */
export function liveInstallDeps(ctx: Server): InstallDeps {
    return {
        serverDir: () => ctx.root(),
        download: (opts) => ctx.files.download({ ...opts, appId: PANEL_ID }),
        javaBinary: ensureJavaFor,
        runInstaller: (run) => runInstallerProcess(run, ctx.process),
        readConfig: async () => ctx.settings,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}

export function liveRecoveryDeps(ctx: Server) {
    return { serverDir: () => ctx.root(), readConfig: async () => ctx.settings, stopLeftoverInstaller: () => stopLeftoverInstaller(ctx.process) };
}
