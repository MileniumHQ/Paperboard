import fs from "node:fs/promises";
import path from "node:path";
import { readVpkDirectory, readVpkFile } from "./vpk";
import type { SourceInstallPictures } from "./index";

// A map's picture from the game's own install, read on the computer that
// runs the server: nothing is fetched. Garry's Mod keeps a PNG of each map
// (maps/thumb/<map>.png) in its archive, and a map someone adds brings its
// own beside it; Counter-Strike 2 keeps a screenshot of each map as a
// Source 2 texture that holds a PNG.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** the version of the Source 2 resource header every compiled file starts with */
const RESOURCE_HEADER_VERSION = 12;
const MAP_NAME = /^[a-z0-9_]+$/i;
/** a picture larger than this is not a map's thumbnail */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The PNG a compiled Source 2 texture holds. Its resource header gives its
 * own length first, and an image stored as a PNG follows the header whole.
 * Throws for a texture stored any other way.
 */
export function pngInTexture(texture: Buffer, name: string): Buffer {
    if (texture.length < 8 || texture.readUInt16LE(4) !== RESOURCE_HEADER_VERSION) throw new Error(`${name} is not a Source 2 texture`);
    const start = texture.readUInt32LE(0);
    const png = texture.subarray(start);
    if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${name} doesn't hold a PNG picture`);
    return png;
}

/** A file's picture as PNG bytes: the file itself, or the PNG a texture holds. */
function asPng(bytes: Buffer, name: string): Buffer {
    const png = name.endsWith(".vtex_c") ? pngInTexture(bytes, name) : bytes;
    if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${name} is not a PNG picture`);
    if (png.length > MAX_BYTES) throw new Error(`${name} is larger than a map picture should be`);
    return png;
}

const forMap = (template: string, map: string) => template.replaceAll("{map}", map);

/**
 * A map's picture as a data URL, from the folder the game's files are in, or
 * null when the game has none for it (a map made at home, a Workshop map).
 * The game's own archive missing is an error: the install is broken.
 */
export async function installMapPicture(gameDir: string, pictures: SourceInstallPictures, map: string): Promise<string | null> {
    if (map.startsWith("workshop/")) return null;
    if (!MAP_NAME.test(map)) throw new Error(`"${map}" is not a map name`);
    let png: Buffer | null = null;
    if (pictures.loose) {
        const file = path.join(gameDir, forMap(pictures.loose, map));
        const bytes = await fs.readFile(file).catch((err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") return null;
            throw new Error(`Couldn't read ${forMap(pictures.loose!, map)}: ${err.message}`);
        });
        if (bytes) png = asPng(bytes, path.basename(file));
    }
    if (!png) {
        const archive = path.join(gameDir, pictures.archive);
        const directory = await readVpkDirectory(archive).catch((err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") throw new Error(`${pictures.archive} is missing from the server's files; update the server to repair it`);
            throw err;
        });
        const inside = forMap(pictures.path, map);
        const bytes = await readVpkFile(directory, inside);
        if (bytes) png = asPng(bytes, path.posix.basename(inside));
    }
    return png ? `data:image/png;base64,${png.toString("base64")}` : null;
}
