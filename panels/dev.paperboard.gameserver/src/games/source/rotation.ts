// The maps a Source server has and plays: the .bsp files it has installed,
// the Steam Workshop maps added to it, the map it starts on and its rotation.
import type { ServerCalls } from "../../service/calls";
import { SOURCE_CALLS as ids, type SourceMapCycle } from "./index";
import { mapName } from "./config";
import { checkRotation, DEFAULT_MAPCYCLE, findMap, installedMaps, PAPERBOARD_MAPCYCLE, readServerCycle } from "./mapcycle";
import { mapPictures, wikiMapPicture } from "./mapPictures";
import { installMapPicture } from "./installPictures";
import { playModes } from "./modes";
import { canonicalMap, findWorkshopMaps, readWorkshopMaps, workshopId, workshopMapToAdd, workshopName, type SourceWorkshopMap } from "./workshop";
import { rewriteConfigs, userMapCycleFile } from "./files";
import type { SourceGame } from "./instance";

/** The Steam Workshop maps added to this server. */
async function workshopLibrary(game: SourceGame): Promise<SourceWorkshopMap[]> {
    return readWorkshopMaps(game.server.settings.workshopMaps);
}
/** Every map the server can be given: the .bsp files it has, and the Workshop maps added to it. */
async function availableMaps(game: SourceGame): Promise<string[]> {
    return [...(await installedMaps(await game.gameDir())), ...(await workshopLibrary(game)).map((m) => workshopName(m.id))];
}
/** Why a Steam Workshop map can't be removed from the server now, or null: it is the map the server starts on, one it cycles through, or the one it is playing. */
function workshopHeldBy(game: SourceGame, saved: Record<string, unknown>, map: SourceWorkshopMap): string | null {
    const name = workshopName(map.id);
    const state = game.server.state;
    if (saved.map === name) return "The server starts on it. Choose another map on the Overview first.";
    if (Array.isArray(saved.mapCycle) && saved.mapCycle.includes(name)) return "It is in the map rotation. Remove it there first.";
    if (state.serverStatus !== "offline" && state.serverLevel && canonicalMap(state.serverLevel) === name) return "The server is playing it now. Change the map first.";
    return null;
}
async function mapCycleView(game: SourceGame): Promise<SourceMapCycle> {
    const dir = await game.gameDir();
    const workshop = await workshopLibrary(game);
    const installed = [...(await installedMaps(dir)), ...workshop.map((m) => workshopName(m.id))];
    const all = game.server.settings;
    const saved = all.mapCycle;
    const overriddenBy = await userMapCycleFile(game);
    const held = Object.fromEntries(workshop.flatMap((m) => { const why = workshopHeldBy(game, all, m); return why ? [[m.id, why]] : []; }));
    if (Array.isArray(saved)) return { maps: saved as string[], custom: true, file: `cfg/${PAPERBOARD_MAPCYCLE}`, installed, workshop, workshopHeld: held, overriddenBy };
    const read = await readServerCycle(dir, overriddenBy ?? DEFAULT_MAPCYCLE);
    return { maps: read?.maps ?? [], custom: false, file: read?.file ?? null, installed, workshop, workshopHeld: held, overriddenBy };
}
/** A map the server can start on or change to: a .bsp it has, or a Workshop map added to it. */
export async function mapAvailable(game: SourceGame, map: string): Promise<boolean> {
    const id = workshopId(map);
    if (id) return (await workshopLibrary(game)).some((m) => m.id === id);
    return (await findMap(await game.gameDir(), map)) !== null;
}
/** Refuses a rotation set here while the user's own server.cfg picks the map cycle file, which the server follows over it. */
async function refuseOverriddenCycle(game: SourceGame) {
    const overriddenBy = await userMapCycleFile(game);
    if (overriddenBy) throw new Error(`server.cfg in the server folder sets mapcyclefile to ${overriddenBy}, which the server follows over this page. Remove that line to set the rotation here.`);
}
/** Saves the rotation (null: the game's own map cycle) with anything saved beside it, and gives it to a running server. */
async function setRotation(game: SourceGame, rotation: string[] | null, also: Record<string, unknown> = {}) {
    await game.server.updateSettings({ ...also, mapCycle: rotation });
    await rewriteConfigs(game);
    // a running server reads the cycle file again when it changes, and the variable once
    if (game.online()) await game.rcon().exec(`mapcyclefile ${rotation ? PAPERBOARD_MAPCYCLE : DEFAULT_MAPCYCLE}`);
}

/** The calls of the Maps tab, the Workshop and setup's last step. */
export function mapCalls(game: SourceGame): ServerCalls {
    const { spec } = game;
    return {
        [ids.maps]: async () => installedMaps(await game.gameDir()),
        [ids.mapPictures]: async () => {
            if (!spec.mapPictures) throw new Error(`${spec.name} has no source of map pictures`);
            return mapPictures(spec.mapPictures);
        },
        ...(spec.mapPictures || spec.installPictures ? {
            [ids.mapPicture]: async (_ctx: unknown, { map }: { map?: unknown }) => spec.installPictures
                ? installMapPicture(await game.gameDir(), spec.installPictures, String(map ?? ""))
                : wikiMapPicture(spec.mapPictures!, String(map ?? "")),
        } : {}),
        [ids.workshopMaps]: () => workshopLibrary(game),
        [ids.workshopFind]: async (_ctx, { query }) => {
            if (typeof query !== "string") throw new Error("Type what to search the Steam Workshop for");
            return findWorkshopMaps(spec, query, new Set((await workshopLibrary(game)).map((m) => m.id)));
        },
        [ids.workshopAdd]: async (ctx, { id }) => {
            game.refuseWhileBusy();
            if (typeof id !== "string" || !/^[1-9]\d{0,19}$/.test(id)) throw new Error("Choose a Steam Workshop item by its id");
            // checked before it can be named: the server leaves a bad item as "will not sync" and plays on
            const map = await workshopMapToAdd(spec, id);
            const have = await workshopLibrary(game);
            await ctx.updateSettings({ workshopMaps: [...have.filter((m) => m.id !== id), map] });
            return workshopLibrary(game);
        },
        [ids.workshopRemove]: async (ctx, { id }) => {
            game.refuseWhileBusy();
            if (typeof id !== "string") throw new Error("Choose a Steam Workshop item by its id");
            const have = await workshopLibrary(game);
            const found = have.find((m) => m.id === id);
            if (!found) throw new Error(`${spec.name} has no Steam Workshop map ${id} added`);
            const held = workshopHeldBy(game, ctx.settings, found);
            if (held) throw new Error(`${found.title} was not removed. ${held}`);
            await ctx.updateSettings({ workshopMaps: have.filter((m) => m.id !== id) });
            return workshopLibrary(game);
        },
        [ids.mapCycle]: () => mapCycleView(game),
        [ids.mapCycleSet]: async (_ctx, { maps }) => {
            game.refuseWhileBusy();
            await refuseOverriddenCycle(game);
            // null hands the rotation back to the game's map cycle file
            await setRotation(game, maps === null ? null : checkRotation(maps, await availableMaps(game)));
            return mapCycleView(game);
        },
        // setup's last choice: how the server plays. A mode makes its installed maps the rotation, the chosen map first
        // and the one the server starts on; no mode leaves the rotation to the game's map cycle
        [ids.play]: async (_ctx, { mode, map: raw }) => {
            game.refuseWhileBusy();
            const installed = await installedMaps(await game.gameDir());
            const map = mapName(raw);
            if (!(await mapAvailable(game, map))) throw new Error(`${map} is not installed`);
            let rotation: string[] | null = null;
            if (mode !== null) {
                const chosen = playModes(spec, installed).find((m) => m.prefix === mode);
                if (!chosen) throw new Error(`${spec.name} has no installed maps for that mode`);
                if (!chosen.maps.includes(map)) throw new Error(`${map} is not a ${chosen.name} map`);
                rotation = checkRotation([map, ...chosen.maps.filter((m) => m !== map)], installed);
            }
            if (rotation) await refuseOverriddenCycle(game);
            await setRotation(game, rotation, { map, configured: true });
            await game.loadOptions();
            return mapCycleView(game);
        },
        [ids.changeMap]: async (ctx, { map: raw }) => {
            const map = mapName(raw);
            if (!(await mapAvailable(game, map))) throw new Error(`${map} is not installed`);
            const running = game.online();
            await ctx.updateSettings({ map });
            if (running) await game.rcon().exec(`changelevel ${map}`);
            await game.loadOptions();
            return { now: running };
        },
    };
}
