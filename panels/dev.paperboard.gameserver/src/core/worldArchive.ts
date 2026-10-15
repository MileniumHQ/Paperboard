// Worlds in and out of zip files. A downloaded world is a zip of its folders
// (<name>/, <name>_nether/, <name>_the_end/); an uploaded one may be that,
// a single world folder, or a world's files at the zip's top. These rules
// decide where each zip entry goes; service/worldTransfer.ts moves bytes.

import { safePackPath } from "./modpack";
import { WORLD_NAME_PATTERN } from "./worlds";

/** what an uploaded world may unpack to, and how many files it may hold */
export const MAX_WORLD_IMPORT_BYTES = 16 * 1024 * 1024 * 1024;
export const MAX_WORLD_IMPORT_ENTRIES = 200_000;
/** a download is one zip without zip64, which tops out below these */
export const MAX_WORLD_EXPORT_ENTRIES = 65_000;
export const MAX_WORLD_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;
/** where downloads are built and uploads land, inside the server folder */
export const WORLD_TRANSFER_DIR = ".paperboard-transfer";

export const DIMENSION_SUFFIXES = ["", "_nether", "_the_end"] as const;

/** the server holds this open while running; a copy of it locks nothing */
export function skipOnExport(relativePath: string): boolean {
    return relativePath.split("/").pop() === "session.lock";
}

/** region files are compressed already; deflating them again wastes time */
export function storeWithoutCompression(relativePath: string): boolean {
    return /\.(mca|mcc|png|zip|jar)$/i.test(relativePath);
}

export interface WorldImportPlan {
    /** zip entry name → path below the server folder, with <name> in place */
    targets: Map<string, string>;
    /** the folders the import creates, e.g. ["survival", "survival_nether"] */
    folders: string[];
}

function fail(reason: string): never {
    throw new Error(`This zip cannot be added as a world: ${reason}`);
}

const ignored = (name: string) => name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store";

/** where the zip's world is, and where each of its files goes for `name` */
export function planWorldImport(entryNames: readonly string[], name: string): WorldImportPlan {
    if (!WORLD_NAME_PATTERN.test(name)) fail(`"${name}" is not a usable world name`);
    if (entryNames.length > MAX_WORLD_IMPORT_ENTRIES) fail(`it holds over ${MAX_WORLD_IMPORT_ENTRIES} files`);
    const files = entryNames.filter((entry) => !entry.endsWith("/") && !ignored(entry));

    // the world is the shallowest level.dat that is not a nether or end folder
    const levels = files
        .filter((entry) => entry === "level.dat" || entry.endsWith("/level.dat"))
        .map((entry) => entry.slice(0, -"level.dat".length))
        .filter((dir) => !/(_nether|_the_end)\/$/.test(dir));
    if (levels.length === 0) fail("it has no level.dat, so it is not a Minecraft world");
    const depth = (dir: string) => dir.split("/").length;
    const shallowest = Math.min(...levels.map(depth));
    const roots = levels.filter((dir) => depth(dir) === shallowest);
    if (roots.length > 1) fail("it holds more than one world; add them one at a time");
    const root = roots[0]!;

    // a world folder's nether and end sit beside it, named after it
    const prefixes: [string, string][] = [[root, name]];
    if (root) {
        const parent = root.slice(0, root.slice(0, -1).lastIndexOf("/") + 1);
        const base = root.slice(parent.length, -1);
        for (const suffix of DIMENSION_SUFFIXES.slice(1)) prefixes.push([`${parent}${base}${suffix}/`, `${name}${suffix}`]);
    }

    const targets = new Map<string, string>();
    const seen = new Set<string>();
    for (const entry of files) {
        const match = prefixes.find(([prefix]) => entry.startsWith(prefix));
        if (!match) continue;
        const rest = safePackPath(entry.slice(match[0].length));
        if (!rest) fail(`it holds an unsafe file path ${JSON.stringify(entry)}`);
        const target = `${match[1]}/${rest}`;
        const key = target.toLowerCase();
        if (seen.has(key)) fail(`it holds ${target} twice`);
        seen.add(key);
        targets.set(entry, target);
    }
    const folders = prefixes.map(([, folder]) => folder).filter((folder) => [...targets.values()].some((t) => t.startsWith(`${folder}/`)));
    return { targets, folders };
}

/** a free world name from an uploaded file's name: "My World (2).zip" → "My_World_2" */
export function worldNameFromFile(fileName: string, taken: readonly string[]): string {
    const stem = fileName.replace(/\.zip$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|_+$/g, "").slice(0, 48) || "world";
    const lower = new Set(taken.map((t) => t.toLowerCase()));
    const free = (candidate: string) => DIMENSION_SUFFIXES.every((suffix) => !lower.has(`${candidate}${suffix}`.toLowerCase()));
    if (free(stem)) return stem;
    for (let n = 2; ; n++) if (free(`${stem}_${n}`)) return `${stem}_${n}`;
}
