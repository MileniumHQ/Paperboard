import { files as fileApi, type ServiceContext } from "@paperboard-dev/paperapi";
import { sanitizeFileName, listDirectory } from "../lib/filesystem";
import { collectWorldDirs, deleteWorldDirs, WORLD_NAME_PATTERN, assertShellSafeLevelName } from "../core/worlds";
import { parseProperties, extractLevelName } from "../core/properties";
import { type GameServerState, PANEL_ID } from "./types";
import { makeTrashRemoveDeps } from "./trashDeps";

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
    await deleteWorldDirs(levelName, makeTrashRemoveDeps("Service:Worlds"));
}

// the server's actual level-name from server.properties — the Worlds tab
// lets the user rename it, so deletes must follow the file, not a
// hardcoded "world". Missing file means a fresh server ("world"); a
// present-but-shell-unsafe name refuses loudly instead of deleting the
// wrong directory.
export async function resolveLevelName(): Promise<string> {
    let content: string | null = null;
    try {
        content = await fileApi.read("server.properties", PANEL_ID);
    } catch (err) {
        console.debug("[Service:Worlds] server.properties unreadable, assuming default level:", String(err));
    }
    if (!content) return "world";
    const raw = extractLevelName(parseProperties(content));
    if (!raw) return "world";
    return assertShellSafeLevelName(raw);
}
