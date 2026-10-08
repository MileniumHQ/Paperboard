import { config, files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { updatePanelConfig } from "./config";
import { ensureJavaFor } from "./java";
import { runInstallerProcess, stopLeftoverInstaller } from "./installerProcess";
import type { InstallDeps } from "./softwareInstall";
import { PANEL_ID, type GameServerState } from "./types";

async function readConfig(): Promise<Record<string, unknown>> {
    const saved = await config.get<Record<string, unknown>>(PANEL_ID);
    return saved && typeof saved === "object" ? saved : {};
}

const serverDir = () => fileApi.getPath("", PANEL_ID);

/** The daemon-backed dependencies of installServerSoftware. */
export function liveInstallDeps(ctx: ServiceContext<GameServerState>): InstallDeps {
    return {
        serverDir,
        download: (opts) => fileApi.download({ ...opts, appId: PANEL_ID }),
        javaBinary: ensureJavaFor,
        runInstaller: (run) => runInstallerProcess(run),
        readConfig,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
    };
}

export function liveRecoveryDeps() {
    return { serverDir, readConfig, stopLeftoverInstaller: () => stopLeftoverInstaller() };
}
