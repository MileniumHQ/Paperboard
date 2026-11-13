import fs from "node:fs/promises";
import path from "node:path";

// Valve's VPK archives, which hold a Source game's own files. A directory
// file (pak01_dir.vpk) lists every file by extension, folder and name, with
// where its bytes are: in a numbered archive beside it (pak01_000.vpk), at
// the end of the directory file itself, or in the listing ("preload"). Source
// (version 1) and Source 2 (version 2, with a longer header) share the layout.

const SIGNATURE = 0x55aa1234;
/** the archive index of a file kept at the end of the directory file */
const IN_DIRECTORY = 0x7fff;
const ENTRY_END = 0xffff;

interface VpkEntry {
    archive: number;
    offset: number;
    length: number;
    preload: Buffer;
}

/** A VPK's listing: its files by path in lower case, and where their bytes are. */
export interface VpkDirectory {
    file: string;
    /** where a file kept in the directory file starts: after the header and listing */
    dataStart: number;
    entries: Map<string, VpkEntry>;
}

/** Reads a directory file's listing. Throws on a file that isn't one. */
export function parseVpkDirectory(file: string, data: Buffer): VpkDirectory {
    if (data.length < 12 || data.readUInt32LE(0) !== SIGNATURE) throw new Error(`${path.basename(file)} is not a VPK archive`);
    const version = data.readUInt32LE(4);
    if (version !== 1 && version !== 2) throw new Error(`${path.basename(file)} is VPK version ${version}, which Paperboard can't read`);
    const treeSize = data.readUInt32LE(8);
    const headerSize = version === 1 ? 12 : 28;
    const treeEnd = headerSize + treeSize;
    if (treeEnd > data.length) throw new Error(`${path.basename(file)} is cut short`);
    let at = headerSize;
    const text = () => {
        const end = data.indexOf(0, at);
        if (end < 0 || end >= treeEnd) throw new Error(`${path.basename(file)} has a broken listing`);
        const value = data.toString("latin1", at, end);
        at = end + 1;
        return value;
    };
    const entries = new Map<string, VpkEntry>();
    for (let extension = text(); extension; extension = text()) {
        for (let folder = text(); folder; folder = text()) {
            for (let name = text(); name; name = text()) {
                if (at + 18 > treeEnd) throw new Error(`${path.basename(file)} has a broken listing`);
                const preloadLength = data.readUInt16LE(at + 4);
                const archive = data.readUInt16LE(at + 6);
                const offset = data.readUInt32LE(at + 8);
                const length = data.readUInt32LE(at + 12);
                if (data.readUInt16LE(at + 16) !== ENTRY_END) throw new Error(`${path.basename(file)} has a broken listing`);
                at += 18;
                const preload = data.subarray(at, at + preloadLength);
                at += preloadLength;
                // a blank folder or extension is written as one space
                const full = `${folder === " " ? "" : `${folder}/`}${name}${extension === " " ? "" : `.${extension}`}`;
                entries.set(full.toLowerCase(), { archive, offset, length, preload });
            }
        }
    }
    return { file, dataStart: treeEnd, entries };
}

// a listing is read once for as long as its file is unchanged (a game update rewrites it)
const listings = new Map<string, { stamp: string; listing: VpkDirectory }>();

/** A directory file's listing, kept while the file is unchanged. Throws when it is missing. */
export async function readVpkDirectory(file: string): Promise<VpkDirectory> {
    const stat = await fs.stat(file);
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const have = listings.get(file);
    if (have?.stamp === stamp) return have.listing;
    const listing = parseVpkDirectory(file, await fs.readFile(file));
    listings.set(file, { stamp, listing });
    return listing;
}

/** The bytes of a file in the archive, or null when it has no such file. */
export async function readVpkFile(directory: VpkDirectory, file: string): Promise<Buffer | null> {
    const entry = directory.entries.get(file.toLowerCase());
    if (!entry) return null;
    if (entry.length === 0) return entry.preload;
    const archive = entry.archive === IN_DIRECTORY
        ? directory.file
        : directory.file.replace(/_dir\.vpk$/i, `_${String(entry.archive).padStart(3, "0")}.vpk`);
    const start = entry.archive === IN_DIRECTORY ? directory.dataStart + entry.offset : entry.offset;
    const handle = await fs.open(archive, "r");
    try {
        const bytes = Buffer.alloc(entry.length);
        const { bytesRead } = await handle.read(bytes, 0, entry.length, start);
        if (bytesRead !== entry.length) throw new Error(`${path.basename(archive)} ends before ${file}`);
        return Buffer.concat([entry.preload, bytes]);
    } finally {
        await handle.close();
    }
}
