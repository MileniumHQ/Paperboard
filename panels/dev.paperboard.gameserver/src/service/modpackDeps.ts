import type { Server } from "./server";
import { minecraftSoftware } from "../games/minecraft/index";
import * as crypto from "node:crypto";
import * as nodeFs from "node:fs";

import { updatePanelConfig } from "../games/minecraft/config";
import { fetchJson } from "../software/http";
import { currentInstall } from "../software/installRecord";
import { isServerSoftware } from "../software/catalog";
import { resolveLevelName } from "./worlds";
import { installServerSoftwareLocked } from "../games/minecraft/softwareInstall";
import { liveInstallDeps } from "./softwareInstallDeps";
import type { ModpackDeps } from "./modpacks";
import { PANEL_ID } from "./types";

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


/** The daemon-backed dependencies of the modpack service. */
export function liveModpackDeps(ctx: Server): ModpackDeps {
    return {
        serverDir: () => ctx.root(),
        levelName: () => resolveLevelName(ctx),
        fetchJson,
        download: (opts) => ctx.files.download({ ...opts, appId: PANEL_ID }),
        sha512,
        readConfig: async () => ctx.settings,
        writeConfig: (patch) => updatePanelConfig(ctx, patch),
        installed: async () => {
            const saved = ctx.settings;
            const { record } = currentInstall(saved);
            if (record) return { software: record.software, version: record.version, build: record.build };
            // installs from before the record: what config and state say, build unknown
            const software = isServerSoftware(saved.software) ? saved.software : minecraftSoftware(ctx.state.serverSoftware);
            const version = typeof saved.version === "string" ? saved.version : ctx.state.serverVersion;
            return { software, version, build: null };
        },
        installSoftware: (software, version, build, configPatch) =>
            installServerSoftwareLocked(ctx, software, version, liveInstallDeps(ctx), { build, configPatch }),
        publish: (modpackProgress) => ctx.setState({ modpackProgress }),
    };
}

export function liveModpackRecoveryDeps(ctx: Server) {
    return { serverDir: () => ctx.root(), readConfig: async () => ctx.settings };
}
