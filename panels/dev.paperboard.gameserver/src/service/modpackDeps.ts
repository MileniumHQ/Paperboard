import * as crypto from "node:crypto";
import * as nodeFs from "node:fs";
import { config, files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { updatePanelConfig } from "./config";
import { fetchJson } from "../software/http";
import { currentInstall } from "../software/installRecord";
import { isServerSoftware } from "../software/catalog";
import { resolveLevelName } from "./worlds";
import { installServerSoftwareLocked } from "./softwareInstall";
import { liveInstallDeps } from "./softwareInstallDeps";
import type { ModpackDeps } from "./modpacks";
import { PANEL_ID, type GameServerState } from "./types";

async function readConfig(): Promise<Record<string, unknown>> {
    const saved = await config.get<Record<string, unknown>>(PANEL_ID);
    return saved && typeof saved === "object" ? saved : {};
}

function sha512(absolutePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha512");
        nodeFs
            .createReadStream(absolutePath)
            .on("error", reject)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")));
    });
}

const serverDir = () => fileApi.getPath("", PANEL_ID);

/** The daemon-backed dependencies of the modpack service. */
export function liveModpackDeps(ctx: ServiceContext<GameServerState>): ModpackDeps {
    return {
        serverDir,
        levelName: resolveLevelName,
        fetchJson,
        download: (opts) => fileApi.download({ ...opts, appId: PANEL_ID }),
        sha512,
        readConfig,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
        installed: async () => {
            const saved = await readConfig();
            const { record } = currentInstall(saved);
            if (record) return { software: record.software, version: record.version, build: record.build };
            // installs from before the record: what config and state say, build unknown
            const software = isServerSoftware(saved.software) ? saved.software : ctx.state.serverSoftware;
            const version = typeof saved.version === "string" ? saved.version : ctx.state.serverVersion;
            return { software, version, build: null };
        },
        installSoftware: (software, version, build) =>
            installServerSoftwareLocked(ctx, software, version, liveInstallDeps(ctx), { build }),
        publish: (modpackProgress) => ctx.setState({ modpackProgress }),
    };
}

export function liveModpackRecoveryDeps() {
    return { serverDir, readConfig };
}
