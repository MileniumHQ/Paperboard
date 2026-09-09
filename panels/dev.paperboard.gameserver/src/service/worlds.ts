import {
    files as fileApi,
    system,
    terminal as terminalApi,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { sanitizeFileName, listDirectory } from "../lib/filesystem";
import { collectWorldDirs, deleteWorldDirs, WORLD_NAME_PATTERN } from "../core/worlds";
import { type GameServerState, PANEL_ID } from "./types";

export { WORLD_NAME_PATTERN };

export async function listWorldDirs(): Promise<string[]> {
    const entries = await listDirectory("");
    return collectWorldDirs({
        entries,
        sanitize: sanitizeFileName,
        exists: (path) => fileApi.exists(path, PANEL_ID),
    });
}

export async function deleteActiveWorldDirs(
    _ctx: ServiceContext<GameServerState>,
    levelName: string,
): Promise<void> {
    await deleteWorldDirs(levelName, {
        getServerDir: () => fileApi.getPath("", PANEL_ID),
        getTargetOs: async () => (await system.getInfo()).os,
        createPty: (id, opts) => terminalApi.create(id, opts),
        writePty: (id, data) => terminalApi.write(id, data),
        scheduleDestroy: (id) => {
            setTimeout(() => {
                try {
                    terminalApi.destroy(id);
                } catch (err) {
                    console.error("[Service:Worlds] Failed to clean up pty:", err);
                }
            }, 1000);
        },
    });
}
