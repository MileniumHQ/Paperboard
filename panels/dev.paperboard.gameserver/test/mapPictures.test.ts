import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir } from "./helpers/tmp";
import { installMapPicture, pngInTexture } from "../src/games/source/installPictures";
import { parseVpkDirectory } from "../src/games/source/vpk";
import { GMOD } from "../src/games/gmod";
import { CS2 } from "../src/games/cs2";

// A 1×1 PNG, as the games' thumbnails are PNGs.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const OTHER_PNG = Buffer.concat([PNG.subarray(0, PNG.length - 12), Buffer.from([0, 0, 0, 0]), PNG.subarray(PNG.length - 8)]);
const IN_DIRECTORY = 0x7fff;

/** A compiled Source 2 texture stored as a PNG: the resource header (its own length first, header version 12), then the PNG. */
function texture(png: Buffer): Buffer {
    const header = Buffer.alloc(16);
    header.writeUInt32LE(16, 0);
    header.writeUInt16LE(12, 4);
    header.writeUInt16LE(1, 6);
    header.writeUInt32LE(8, 8);
    header.writeUInt32LE(0, 12);
    return Buffer.concat([header, png]);
}

type Placed = { bytes: Buffer; archive: number; preload?: number };

/**
 * Writes a VPK as Valve's tools lay it out: `<name>_dir.vpk` lists the files
 * by extension, folder and name, and their bytes go in `<name>_NNN.vpk` or
 * after the listing (IN_DIRECTORY), the first `preload` of them in the listing.
 */
function writeVpk(dir: string, name: string, version: 1 | 2, files: Record<string, Placed>) {
    const tree = new Map<string, Map<string, [string, Placed][]>>();
    for (const [file, placed] of Object.entries(files)) {
        const folder = path.posix.dirname(file);
        const base = path.posix.basename(file);
        const dot = base.lastIndexOf(".");
        const ext = base.slice(dot + 1);
        const folders = tree.get(ext) ?? new Map<string, [string, Placed][]>();
        tree.set(ext, folders);
        folders.set(folder, [...(folders.get(folder) ?? []), [base.slice(0, dot), placed]]);
    }
    const archives = new Map<number, Buffer[]>();
    const sized = (index: number) => (archives.get(index) ?? []).reduce((n, b) => n + b.length, 0);
    const text = (value: string) => Buffer.from(`${value}\0`, "latin1");
    const listing: Buffer[] = [];
    for (const [ext, folders] of tree) {
        listing.push(text(ext));
        for (const [folder, names] of folders) {
            listing.push(text(folder));
            for (const [base, placed] of names) {
                const preload = placed.bytes.subarray(0, placed.preload ?? 0);
                const rest = placed.bytes.subarray(placed.preload ?? 0);
                const entry = Buffer.alloc(18);
                entry.writeUInt16LE(preload.length, 4);
                entry.writeUInt16LE(placed.archive, 6);
                entry.writeUInt32LE(sized(placed.archive), 8);
                entry.writeUInt32LE(rest.length, 12);
                entry.writeUInt16LE(0xffff, 16);
                archives.set(placed.archive, [...(archives.get(placed.archive) ?? []), rest]);
                listing.push(text(base), entry, preload);
            }
            listing.push(text(""));
        }
        listing.push(text(""));
    }
    listing.push(text(""));
    const body = Buffer.concat(listing);
    const header = Buffer.alloc(version === 1 ? 12 : 28);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(version, 4);
    header.writeUInt32LE(body.length, 8);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}_dir.vpk`), Buffer.concat([header, body, ...(archives.get(IN_DIRECTORY) ?? [])]));
    for (const [index, parts] of archives) {
        if (index !== IN_DIRECTORY) fs.writeFileSync(path.join(dir, `${name}_${String(index).padStart(3, "0")}.vpk`), Buffer.concat(parts));
    }
}

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

describe("map pictures from a game's install", () => {
    test("Garry's Mod's thumbnails come from its archive, and a map someone adds brings its own", async () => {
        const game = path.join(tempDir(), "garrysmod");
        writeVpk(game, "garrysmod", 2, {
            "maps/thumb/gm_construct.png": { bytes: PNG, archive: 0 },
            "maps/thumb/gm_flatgrass.png": { bytes: PNG, archive: IN_DIRECTORY, preload: 6 },
        });
        fs.mkdirSync(path.join(game, "maps", "thumb"), { recursive: true });
        fs.writeFileSync(path.join(game, "maps", "thumb", "gm_bigcity.png"), OTHER_PNG);

        expect(await installMapPicture(game, GMOD.installPictures!, "gm_construct")).toBe(dataUrl(PNG));
        expect(await installMapPicture(game, GMOD.installPictures!, "gm_flatgrass")).toBe(dataUrl(PNG));
        expect(await installMapPicture(game, GMOD.installPictures!, "gm_bigcity")).toBe(dataUrl(OTHER_PNG));
        // made at home or from the Workshop: no picture, which is no failure
        expect(await installMapPicture(game, GMOD.installPictures!, "gm_mine")).toBeNull();
        expect(await installMapPicture(game, GMOD.installPictures!, "workshop/12345")).toBeNull();
        await expect(installMapPicture(game, GMOD.installPictures!, "../../secrets")).rejects.toThrow("is not a map name");
    });

    test("Counter-Strike 2's screenshots are the PNGs its textures hold", async () => {
        const game = path.join(tempDir(), "game", "csgo");
        const shot = (map: string) => `panorama/images/map_icons/screenshots/360p/${map}_png.vtex_c`;
        writeVpk(game, "pak01", 2, {
            [shot("de_dust2")]: { bytes: texture(PNG), archive: 3 },
            [shot("de_broken")]: { bytes: texture(Buffer.from("DDS not a png")), archive: 3 },
        });
        expect(await installMapPicture(game, CS2.installPictures!, "de_dust2")).toBe(dataUrl(PNG));
        expect(await installMapPicture(game, CS2.installPictures!, "de_inferno")).toBeNull();
        await expect(installMapPicture(game, CS2.installPictures!, "de_broken")).rejects.toThrow("doesn't hold a PNG picture");
        expect(() => pngInTexture(PNG, "x.vtex_c")).toThrow("is not a Source 2 texture");
    });

    test("a broken install says so instead of showing no pictures", async () => {
        const game = path.join(tempDir(), "garrysmod");
        fs.mkdirSync(game, { recursive: true });
        await expect(installMapPicture(game, GMOD.installPictures!, "gm_construct")).rejects.toThrow("garrysmod_dir.vpk is missing from the server's files");
        fs.writeFileSync(path.join(game, "garrysmod_dir.vpk"), "not an archive");
        await expect(installMapPicture(game, GMOD.installPictures!, "gm_construct")).rejects.toThrow("is not a VPK archive");
        expect(() => parseVpkDirectory("x_dir.vpk", Buffer.from([0x34, 0x12, 0xaa, 0x55, 3, 0, 0, 0, 0, 0, 0, 0]))).toThrow("VPK version 3");
    });
});
