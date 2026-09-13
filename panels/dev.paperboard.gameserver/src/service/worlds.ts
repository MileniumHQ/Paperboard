import { files as fileApi, type ServiceContext } from "@paperboard-dev/paperapi";
import properties from "dot-properties";
import { sanitizeFileName, listDirectory } from "../lib/filesystem";
import {
    buildWorldInfos,
    collectWorldDirs,
    deleteWorldDirs,
    planWorldActivation,
    WORLD_NAME_PATTERN,
    assertShellSafeLevelName,
    type WorldInfo,
} from "../core/worlds";
import { parseProperties, extractLevelName } from "../core/properties";
import { type GameServerState, PANEL_ID } from "./types";
import { makeTrashRemoveDeps } from "./trashDeps";

export { WORLD_NAME_PATTERN };
export type { WorldInfo };

export async function listWorldDirs(): Promise<string[]> {
    const entries = await listDirectory("");
    return collectWorldDirs({
        entries,
        sanitize: sanitizeFileName,
        exists: (path) => fileApi.exists(path, PANEL_ID),
    });
}

export async function deleteActiveWorldDirs(
    ctx: ServiceContext<GameServerState>,
    levelName: string,
): Promise<void> {
    // enforce offline here, at the owner, not only in the action that calls it
    assertServerOffline(ctx);
    await deleteWorldDirs(levelName, makeTrashRemoveDeps("Service:Worlds"));
}

// world mutations are offline-only: the server holds open handles on the
// active world's region files and regenerates missing dirs on boot, so a
// switch or delete issued while running either silently no-ops or eats
// the fresh generation. The boundary is here, not the component — the UI
// disables the buttons too, but a forged bridge call still refuses.
export function assertServerOffline(ctx: ServiceContext<GameServerState>): void {
    if (ctx.state.serverStatus !== "offline") {
        throw new Error("Stop the server before managing worlds");
    }
}

// rich listing for the manager: every on-disk world with its active flag
// and which dimensions have generated data. Dimension presence is a
// level.dat check per dimension — a world whose nether was never entered
// honestly reports "not generated" instead of pretending.
export async function listWorlds(): Promise<WorldInfo[]> {
    const [generated, active] = await Promise.all([
        listWorldDirs(),
        resolveLevelName(),
    ]);
    // every generated directory plus the configured active world, which is
    // shown (generated:false) even before its first start
    const infos = buildWorldInfos(
        generated.map((name) => ({ name, generated: true })),
        active,
    );
    await Promise.all(
        infos
            .filter((info) => info.generated)
            .map(async (info) => {
                const safe = info.name;
                try {
                    const [nether, end] = await Promise.all([
                        fileApi.exists(`${safe}_nether/level.dat`, PANEL_ID),
                        fileApi.exists(`${safe}_the_end/level.dat`, PANEL_ID),
                    ]);
                    info.hasNether = nether === true;
                    info.hasEnd = end === true;
                } catch (err) {
                    console.debug(`[Service:Worlds] dimension check failed for "${safe}":`, String(err));
                }
            }),
    );
    return infos;
}

export interface SetActiveWorldResult {
    activated: string;
    created: boolean;
}

// makes `levelName` the boot target: an existing directory switches,
// a fresh name generates on next start (with the given seed when set).
// seed on an existing world is refused — level-seed only applies to
// generation, silently writing it would lie about what it does.
export async function setActiveWorld(
    ctx: ServiceContext<GameServerState>,
    levelName: string,
    seed?: string,
): Promise<SetActiveWorldResult> {
    assertServerOffline(ctx);
    const [existing, active] = await Promise.all([listWorldDirs(), resolveLevelName()]);
    const plan = planWorldActivation(levelName, existing, active);
    if (plan.kind === "noop-active") {
        return { activated: plan.name, created: false };
    }
    const cleanSeed = String(seed ?? "").trim();
    if (plan.kind === "switch" && cleanSeed) {
        throw new Error(`"${plan.name}" already exists — a seed only applies to a new world`);
    }
    if (cleanSeed && /[\r\n]/.test(cleanSeed)) {
        throw new Error("Refusing multi-line seed");
    }

    let content: string | null = null;
    try {
        content = await fileApi.read("server.properties", PANEL_ID);
    } catch (err) {
        console.debug("[Service:Worlds] server.properties unreadable, writing fresh:", String(err));
    }
    const props = content ? parseProperties(content) : {};
    props["level-name"] = plan.name;
    if (plan.kind === "create") {
        props["level-seed"] = cleanSeed;
    }
    const out = properties.stringify(props, { keySep: "=", lineWidth: null, latin1: false });
    await fileApi.write("server.properties", out, PANEL_ID);
    return { activated: plan.name, created: plan.kind === "create" };
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
