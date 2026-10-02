import { config, files as fileApi, type ServiceContext } from "@paperboard-dev/paperapi";
import properties from "dot-properties";
import { sanitizeFileName, listDirectory } from "../lib/filesystem";
import {
    buildWorldInfos,
    collectWorldDirs,
    getWorldDirsToDelete,
    planWorldActivation,
    WORLD_NAME_PATTERN,
    assertShellSafeLevelName,
    type WorldInfo,
} from "../core/worlds";
import { parseProperties, extractLevelName } from "../core/properties";
import { type GameServerState, PANEL_ID } from "./types";
import { makeTrashRemoveDeps } from "./trashDeps";
import { trashRemovePathsWith } from "./trash";

export { WORLD_NAME_PATTERN };
export type { WorldInfo };

// Created-but-never-started worlds have no directory yet, so disk listing
// cannot find them. They used to be remembered only as the active
// level-name, which meant switching away dropped them from the UI. Persist
// their names until they generate (or are deleted) so a created world does
// not vanish on switch.
const MAX_PENDING_WORLDS = 100;

// A missing config reads as null (no created worlds yet). An unreadable
// one throws: listing it as "no created worlds" would hide them, and
// writing over it would replace the whole panel config (software,
// version, …) with just this list.
async function readPendingWorlds(): Promise<string[]> {
    const saved = await config.get<Record<string, unknown> | null>(PANEL_ID);
    const list = saved?.pendingWorlds;
    if (!Array.isArray(list)) return [];
    return list.filter(
        (name): name is string =>
            typeof name === "string" && WORLD_NAME_PATTERN.test(name),
    );
}

async function writePendingWorlds(names: string[]): Promise<void> {
    const current = await config.get<Record<string, unknown> | null>(PANEL_ID);
    const saved = current && typeof current === "object" ? current : {};
    await config.set(
        { ...saved, pendingWorlds: names.slice(0, MAX_PENDING_WORLDS) },
        PANEL_ID,
    );
}

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
    // <level>, <level>_nether and <level>_the_end, trashed, never deleted
    await trashRemovePathsWith(makeTrashRemoveDeps(), getWorldDirsToDelete(levelName));
    const pending = await readPendingWorlds();
    const next = pending.filter((n) => n.toLowerCase() !== levelName.toLowerCase());
    if (next.length !== pending.length) await writePendingWorlds(next);
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
    const [generated, active, pending] = await Promise.all([
        listWorldDirs(),
        resolveLevelName(),
        readPendingWorlds(),
    ]);
    // prune names that have since generated, keeping the pending list bounded
    const generatedKeys = new Set(generated.map((name) => name.toLowerCase()));
    const pendingOnly = pending.filter((name) => !generatedKeys.has(name.toLowerCase()));
    if (pendingOnly.length !== pending.length) {
        void writePendingWorlds(pendingOnly).catch((err) =>
            console.debug("[Service:Worlds] pending prune failed:", String(err)),
        );
    }
    // every generated directory and every not-yet-generated created world;
    // the level-name only marks which of them is active
    const infos = buildWorldInfos(
        [
            ...generated.map((name) => ({ name, generated: true })),
            ...pendingOnly.map((name) => ({ name, generated: false })),
        ],
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
// createOnly refuses an existing name outright: the New World flow must
// never degrade into a silent switch when its listing was stale.
export async function setActiveWorld(
    ctx: ServiceContext<GameServerState>,
    levelName: string,
    seed?: string,
    createOnly = false,
): Promise<SetActiveWorldResult> {
    assertServerOffline(ctx);
    const [existing, active] = await Promise.all([listWorldDirs(), resolveLevelName()]);
    const plan = planWorldActivation(levelName, existing, active);
    if (plan.kind === "noop-active") {
        if (createOnly) {
            throw new Error(`A world named "${plan.name}" already exists`);
        }
        return { activated: plan.name, created: false };
    }
    const cleanSeed = String(seed ?? "").trim();
    if (plan.kind === "switch") {
        if (createOnly) {
            throw new Error(`A world named "${plan.name}" already exists`);
        }
        if (cleanSeed) {
            throw new Error(`"${plan.name}" already exists — a seed only applies to a new world`);
        }
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
    if (plan.kind === "create") {
        const pending = await readPendingWorlds();
        if (!pending.some((n) => n.toLowerCase() === plan.name.toLowerCase())) {
            await writePendingWorlds([...pending, plan.name]);
        }
    }
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
