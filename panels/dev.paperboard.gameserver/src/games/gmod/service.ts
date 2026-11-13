import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../serviceKit";
import { sourceService } from "../source/service";
import { pastedWorkshopIds } from "../source/workshop";
import { gmod, GMOD } from "./index";

/** The Workshop collection an option value names: its id, or null for none. A value that names none is refused. */
export function workshopCollection(value: unknown): string | null {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const [id] = pastedWorkshopIds(text);
    if (!id) throw new Error("Workshop collection must be a Steam Workshop link or the number in it");
    return id;
}

/** Whether a game mode's folder is on the server: in the game's own, or in an add-on folder's. */
async function hasGameMode(gameDir: string, mode: string): Promise<boolean> {
    if (await exists(path.join(gameDir, "gamemodes", mode))) return true;
    const addons = path.join(gameDir, "addons");
    if (!(await exists(addons))) return false;
    for (const addon of await fs.readdir(addons)) if (await exists(path.join(addons, addon, "gamemodes", mode))) return true;
    return false;
}

/** `+gamemode` and `+host_workshop_collection`, as the Garry's Mod server takes them. */
export async function launchArgs(saved: Record<string, unknown>, gameDir: string): Promise<string[]> {
    const mode = String(saved.gamemode ?? "sandbox");
    if (!/^[a-z0-9_-]{1,64}$/.test(mode)) throw new Error("Game mode must be a game mode's folder name, such as sandbox or terrortown");
    const collection = workshopCollection(saved.workshopCollection);
    // a mode that comes with the collection is only there once the server has downloaded it
    if (!collection && !(await hasGameMode(gameDir, mode))) throw new Error(`Garry's Mod has no game mode "${mode}". Choose one in Options, or put its add-on in the addons folder.`);
    return ["+gamemode", mode, ...(collection ? ["+host_workshop_collection", collection] : [])];
}

export const gmodService = sourceService({ ...GMOD, launchArgs }, gmod);
