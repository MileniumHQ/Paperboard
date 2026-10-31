import fs from "node:fs/promises";
import path from "node:path";
import { readWorldHeader, type TerrariaWorldHeader } from "./worldFile";
import { worldName } from "./config";
import { trashDirName } from "../../service/trash";

/** One .wld file in a server's worlds folder, as the Worlds tab shows it. */
export interface TerrariaWorld {
    /** the file name without .wld; what the server config names */
    name: string;
    active: boolean;
    /** false for the active world before the start that creates it */
    generated: boolean;
    /** last write, in ms since the epoch */
    modified: number;
    bytes: number;
    /** null when the file could not be read as a world; error says why */
    header: TerrariaWorldHeader | null;
    error?: string;
}

/** Uploads land here first and become worlds only once they read as one. */
export const UPLOAD_DIR = ".terraria-upload";
const UPLOAD_NAME = /^upload-[0-9a-f-]{36}\.wld$/;
// the header sits after a section table and a short bit array: well inside this
const HEADER_BYTES = 64 * 1024;

async function readHeader(file: string): Promise<TerrariaWorldHeader> {
    const handle = await fs.open(file, "r");
    try {
        const buffer = Buffer.alloc(HEADER_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
        return readWorldHeader(buffer.subarray(0, bytesRead));
    } finally {
        await handle.close();
    }
}

export async function listWorlds(directory: string, active: string): Promise<TerrariaWorld[]> {
    await fs.mkdir(directory, { recursive: true });
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
        .filter((e) => e.isFile() && e.name.endsWith(".wld"))
        .map((e) => e.name.slice(0, -4))
        .sort((a, b) => a.localeCompare(b));
    const worlds: TerrariaWorld[] = await Promise.all(entries.map(async (name) => {
        const file = path.join(directory, `${name}.wld`);
        const stat = await fs.stat(file);
        const base = { name, active: name === active, generated: true, modified: stat.mtimeMs, bytes: stat.size };
        try {
            return { ...base, header: await readHeader(file) };
        } catch (err) {
            return { ...base, header: null, error: err instanceof Error ? err.message : String(err) };
        }
    }));
    // a new world exists only as the config's choice until the server starts
    if (active && !entries.includes(active)) worlds.unshift({ name: active, active: true, generated: false, modified: 0, bytes: 0, header: null });
    return worlds;
}

function uploadPath(root: string, file: unknown): string {
    if (typeof file !== "string" || !UPLOAD_NAME.test(file)) throw new Error("Choose a world to upload");
    return path.join(root, UPLOAD_DIR, file);
}

/** A file name for an uploaded world: its own name, minus what file names can't hold */
export function suggestedWorldName(title: string, taken: readonly string[]): string {
    const base = title.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 70) || "World";
    const lower = new Set(taken.map((t) => t.toLowerCase()));
    if (!lower.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Reads an upload's header so the page can name it; a non-world is removed and refused. */
export async function inspectUpload(root: string, file: unknown): Promise<{ header: TerrariaWorldHeader; suggestedName: string }> {
    const source = uploadPath(root, file);
    try {
        const header = await readHeader(source);
        const taken = (await listWorlds(path.join(root, "worlds"), "")).map((w) => w.name);
        return { header, suggestedName: suggestedWorldName(header.name, taken) };
    } catch (err) {
        await fs.rm(source, { force: true });
        throw err;
    }
}

/** Moves a checked upload into the worlds folder; never replaces a world. */
export async function importUpload(root: string, file: unknown, name: unknown): Promise<void> {
    const source = uploadPath(root, file);
    try {
        const checked = worldName(name);
        await readHeader(source);
        const directory = path.join(root, "worlds");
        await fs.mkdir(directory, { recursive: true });
        const taken = (await fs.readdir(directory)).some((f) => f.toLowerCase() === `${checked}.wld`.toLowerCase());
        if (taken) throw new Error(`A world named "${checked}" already exists`);
        // COPYFILE_EXCL: a world written meanwhile under this name is kept, not replaced
        await fs.copyFile(source, path.join(directory, `${checked}.wld`), fs.constants.COPYFILE_EXCL);
    } finally {
        await fs.rm(source, { force: true });
    }
}

export async function discardUpload(root: string, file: unknown): Promise<void> {
    await fs.rm(uploadPath(root, file), { force: true });
}

/**
 * Moves a world, its tModLoader `.twld` and their backups (`.bak`, `.bak2`)
 * into a `.trash-<ts>/worlds` folder in the server folder, like every other
 * removal in Game Server: recoverable, never deleted. The shared trash helper
 * takes ASCII paths only and Terraria world names can be any letters, so the
 * move happens here.
 */
export async function trashWorld(root: string, name: unknown, stamp = Date.now()): Promise<void> {
    const checked = worldName(name);
    const directory = path.join(root, "worlds");
    const world = `${checked}.wld`;
    let entries: string[];
    try {
        entries = await fs.readdir(directory);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        entries = [];
    }
    // tModLoader keeps the modded part of a world beside it, as .twld
    const own = [world, `${checked}.twld`];
    const files = entries.filter((file) => own.some((base) => file === base || (file.startsWith(base) && /^\.bak\d*$/.test(file.slice(base.length)))));
    if (!files.some((file) => file.startsWith(world))) throw new Error(`There is no world named "${checked}"`);
    const trash = path.join(root, trashDirName(stamp), "worlds");
    await fs.mkdir(trash, { recursive: true });
    for (const file of files) await fs.rename(path.join(directory, file), path.join(trash, file));
}
