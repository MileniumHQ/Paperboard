import { searchWorkshop, workshopItems, type ModscanGame, type WorkshopItem, type WorkshopMeta } from "../steam/modscan";
import type { SourceGameSpec } from "./index";

// Steam Workshop maps for a Source game that loads them itself. Measured on the
// Team Fortress 2 dedicated server (build 11191711), logged in anonymously, no
// Web API key: `changelevel workshop/<id>`, `+map workshop/<id>` and a map
// cycle line `workshop/<id>` each make the server track the item, download it
// into steamapps/workshop/content/<app>/<id>/ and load it, in about ten
// seconds, with no other setup. The server then names the map
// `workshop/<file>.ugc<id>` (in status and its log), which also works in a
// cycle file and changelevel; `workshop/<file>` alone is "Failed to find map".
// An id that doesn't exist logs "Error fetching updated information", one of
// another game's item "Invalid workshop map name", and a TF2 item that is no
// map "has no filename and will not sync", and each leaves the server on the
// map it was on. So an item is checked here, before it can be named.

const NAME = /^workshop\/([1-9]\d{0,19})$/;
const LEVEL = /^workshop\/.+\.ugc([1-9]\d{0,19})$/;

/** The server's name for a Workshop map. */
export const workshopName = (id: string) => `workshop/${id}`;

/** The Workshop item a map name is, in either form the server uses; null for a map from a file. */
export function workshopId(name: string): string | null {
    return NAME.exec(name)?.[1] ?? LEVEL.exec(name)?.[1] ?? null;
}

/** A map as Paperboard names it: a Workshop map by its id, however the server wrote it. */
export const canonicalMap = (name: string): string => {
    const id = workshopId(name);
    return id ? workshopName(id) : name;
};

/** A Workshop map a server was given, kept in its settings. */
export interface SourceWorkshopMap {
    id: string;
    title: string;
    /** a picture the Workshop keeps, an https address */
    previewImageUrl: string | null;
    tags: string[];
    subscribers: number | null;
    /** Unix seconds */
    updated: number;
}

/** A search result: a Workshop map, and whether this server has it already. */
export interface SourceWorkshopHit extends SourceWorkshopMap {
    added: boolean;
}

export interface SourceWorkshopResults {
    items: SourceWorkshopHit[];
    /** results Steam gave that no game mode names, which are not maps */
    hidden: number;
    meta: WorkshopMeta;
}

function game(spec: SourceGameSpec): ModscanGame {
    if (!spec.workshop) throw new Error(`${spec.name} has no Steam Workshop maps`);
    return spec.workshop.game;
}

/** The kept form of an item. */
export function workshopMap(item: WorkshopItem): SourceWorkshopMap {
    return { id: item.id, title: item.title, previewImageUrl: item.previewImageUrl, tags: item.tags, subscribers: item.subscriptions, updated: item.timeUpdated };
}

/** Whether an item is a map: the Workshop tags a map with the game modes it plays, and nothing else carries them. */
export function isMapItem(spec: Pick<SourceGameSpec, "mapModes">, item: Pick<WorkshopItem, "tags">): boolean {
    const modes = new Set(Object.values(spec.mapModes ?? {}).map((name) => name.toLowerCase()));
    return item.tags.some((tag) => modes.has(tag.toLowerCase()));
}

/** Item ids in what a person pasted: a bare id, or a Workshop link's id. */
export function pastedWorkshopIds(input: string): string[] {
    const text = input.trim();
    if (/^[1-9]\d{0,19}$/.test(text)) return [text];
    const link = /^https?:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/?\?(?:[^#]*&)?id=([1-9]\d{0,19})(?:[&#].*)?$/i.exec(text);
    return link ? [link[1]!] : [];
}

/** What the Workshop has for a search, or for a pasted link or id, narrowed to maps. */
export async function findWorkshopMaps(spec: SourceGameSpec, query: string, have: ReadonlySet<string>): Promise<SourceWorkshopResults> {
    const pasted = pastedWorkshopIds(query);
    const base = spec.workshop?.base;
    const page = pasted.length > 0
        ? await workshopItems(game(spec), pasted, { base })
        : await searchWorkshop(game(spec), query, { sort: query.trim() ? "relevance" : "subscriptions", base });
    const maps = page.items.filter((item) => isMapItem(spec, item));
    return { items: maps.map((item) => ({ ...workshopMap(item), added: have.has(item.id) })), hidden: page.items.length - maps.length, meta: page.meta };
}

/** One item to add, checked: the Workshop has it for this game and it is a map. */
export async function workshopMapToAdd(spec: SourceGameSpec, id: string): Promise<SourceWorkshopMap> {
    const page = await workshopItems(game(spec), [id], { base: spec.workshop?.base });
    const item = page.items.find((i) => i.id === id);
    if (!item) throw new Error(`Steam Workshop has no public item ${id}`);
    if (!isMapItem(spec, item)) throw new Error(`${item.title} is not a map: Steam Workshop lists no game mode for it${item.tags.length ? ` (its tags are ${item.tags.join(", ")})` : ""}, and ${spec.name} can only play maps`);
    return workshopMap(item);
}

/** The saved list, checked: a damaged setting is a failure, never an empty list. */
export function readWorkshopMaps(saved: unknown): SourceWorkshopMap[] {
    if (saved === undefined) return [];
    if (!Array.isArray(saved)) throw new Error("The saved Steam Workshop maps are damaged");
    return saved.map((entry) => {
        const e = entry as Partial<SourceWorkshopMap> | null;
        if (!e || typeof e.id !== "string" || !/^[1-9]\d{0,19}$/.test(e.id) || typeof e.title !== "string" || !Array.isArray(e.tags)) throw new Error("The saved Steam Workshop maps are damaged");
        return { id: e.id, title: e.title, previewImageUrl: typeof e.previewImageUrl === "string" ? e.previewImageUrl : null, tags: e.tags.map(String), subscribers: typeof e.subscribers === "number" ? e.subscribers : null, updated: typeof e.updated === "number" ? e.updated : 0 };
    });
}
