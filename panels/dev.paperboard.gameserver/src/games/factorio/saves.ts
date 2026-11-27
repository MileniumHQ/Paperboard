import fs from "node:fs/promises";
import path from "node:path";
import { readZipNames } from "../../service/jarEntries";
import { trashDirName } from "../../service/trash";
import { unlessMissing } from "../../service/failures";
import { saveName } from "./settings";

// Factorio's maps are its saves: one zip each in the saves folder, holding
// one folder with the map (level-init.dat from when it was made, level.dat0
// and on once it has been played). The server writes its autosaves beside
// them as _autosave1.zip and on, taking turns; those are left out of the
// list and stay in Files.

/** One save in the saves folder, as the Worlds tab shows it. */
export interface FactorioWorld {
    /** the file name without .zip */
    name: string;
    active: boolean;
    /** always true: a map is made at once, never at a later start */
    generated: boolean;
    /** last write, in ms since the epoch */
    modified: number;
    bytes: number;
}

export const savesDir = (dataDir: string) => path.join(dataDir, "saves");
export const saveFile = (dataDir: string, name: string) => path.join(savesDir(dataDir), `${saveName(name)}.zip`);

export async function listWorlds(dataDir: string, active: string | null): Promise<FactorioWorld[]> {
    const entries = await unlessMissing(fs.readdir(savesDir(dataDir), { withFileTypes: true }), []);
    const names = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".zip") && !e.name.startsWith("_") && !e.name.startsWith("."))
        .map((e) => e.name.slice(0, -4))
        .sort((a, b) => a.localeCompare(b));
    return Promise.all(names.map(async (name) => {
        const stat = await fs.stat(path.join(savesDir(dataDir), `${name}.zip`));
        return { name, active: name === active, generated: true, modified: stat.mtimeMs, bytes: stat.size };
    }));
}

/** Whether a zip is a Factorio save: one folder with a map in it. Throws why not. */
export async function assertSave(file: string): Promise<void> {
    const names = await readZipNames(file, "The save");
    const tops = new Set(names.map((n) => n.split("/")[0]));
    if (tops.size !== 1 || names.some((n) => !n.includes("/"))) throw new Error("This zip isn't a Factorio save: a save holds one folder with its map");
    const top = [...tops][0];
    if (!names.some((n) => n === `${top}/level-init.dat` || /^level\.dat\d*$/.test(n.slice(`${top}/`.length)))) throw new Error("This zip isn't a Factorio save: it has no map in it");
}

/** Uploads land here first and become worlds only once they read as a save. */
export const UPLOAD_DIR = ".factorio-upload";
const UPLOAD_NAME = /^upload-[0-9a-f-]{36}\.zip$/;
function uploadPath(root: string, file: unknown): string {
    if (typeof file !== "string" || !UPLOAD_NAME.test(file)) throw new Error("Choose a save to upload");
    return path.join(root, UPLOAD_DIR, file);
}

/** A free name for an upload, from the folder the save holds. */
export async function inspectUpload(root: string, dataDir: string, file: unknown): Promise<{ suggestedName: string }> {
    const source = uploadPath(root, file);
    try {
        await assertSave(source);
        const top = (await readZipNames(source, "The save"))[0]!.split("/")[0]!;
        const base = top.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/^[^A-Za-z0-9]+/, "").replace(/\.zip$/i, "").slice(0, 55) || "World";
        const taken = new Set((await listWorlds(dataDir, null)).map((w) => w.name.toLowerCase()));
        if (!taken.has(base.toLowerCase())) return { suggestedName: base };
        for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return { suggestedName: `${base} ${n}` };
    } catch (err) {
        await fs.rm(source, { force: true });
        throw err;
    }
}

/** Moves a checked upload into the saves folder; never replaces a save. */
export async function importUpload(root: string, dataDir: string, file: unknown, name: unknown): Promise<void> {
    const source = uploadPath(root, file);
    try {
        const target = saveFile(dataDir, saveName(name));
        await assertSave(source);
        await fs.mkdir(savesDir(dataDir), { recursive: true });
        const taken = (await fs.readdir(savesDir(dataDir))).some((f) => f.toLowerCase() === path.basename(target).toLowerCase());
        if (taken) throw new Error(`A world named "${String(name)}" already exists`);
        // COPYFILE_EXCL: a save written meanwhile under this name is kept, not replaced
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } finally {
        await fs.rm(source, { force: true });
    }
}

export async function discardUpload(root: string, file: unknown): Promise<void> {
    await fs.rm(uploadPath(root, file), { force: true });
}

/** Moves a save into a `.trash-<ts>-<random>/saves` folder in the server folder: recoverable, never deleted. */
export async function trashWorld(root: string, dataDir: string, name: unknown): Promise<void> {
    const file = saveFile(dataDir, saveName(name));
    if (!(await unlessMissing(fs.stat(file), null))) throw new Error(`There is no world named "${String(name)}"`);
    const trash = path.join(root, trashDirName(), "saves");
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(file, path.join(trash, path.basename(file)));
}
