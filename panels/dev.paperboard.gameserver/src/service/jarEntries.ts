import * as nodeFs from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

// Reads a zip's file list, or a few small named files out of a jar, without
// unpacking it: the zip's central directory is read from the end of the
// file, then only the wanted entries. Everything is capped, so a huge or
// hostile zip costs at most a few megabytes.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
export const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
export const MAX_JAR_ENTRY_BYTES = 1024 * 1024;

async function readAt(handle: nodeFs.FileHandle, position: number, length: number, what: string): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) throw new Error(`${what} ends early; it may be damaged.`);
    return buffer;
}

/** One file in a zip's directory. */
interface ZipEntry {
    name: string;
    method: number;
    compressed: number;
    uncompressed: number;
    localOffset: number;
}

/**
 * Every entry in the zip's directory, read from the end of the file; `what`
 * names the file in errors ("The jar"). A damaged or unsupported zip throws.
 */
async function zipDirectory(handle: nodeFs.FileHandle, what: string): Promise<ZipEntry[]> {
    const { size } = await handle.stat();
    if (size < EOCD_MIN) throw new Error(`${what} is too small to be a zip.`);
    const tailLength = Math.min(size, EOCD_MIN + MAX_COMMENT);
    const tail = await readAt(handle, size - tailLength, tailLength, what);
    let eocd = -1;
    for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
        if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error(`${what} has no zip directory; it may be damaged.`);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
        throw new Error(`${what} uses a zip format Paperboard does not read (zip64).`);
    }
    if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error(`${what}'s file list is too large to read.`);
    if (centralOffset + centralSize > size) throw new Error(`${what}'s zip directory points past its end.`);
    const central = await readAt(handle, centralOffset, centralSize, what);

    const entries: ZipEntry[] = [];
    let at = 0;
    while (at + 46 <= central.length) {
        if (central.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error(`${what}'s zip directory is damaged.`);
        const nameLength = central.readUInt16LE(at + 28);
        const extraLength = central.readUInt16LE(at + 30);
        const commentLength = central.readUInt16LE(at + 32);
        entries.push({
            name: central.toString("utf8", at + 46, at + 46 + nameLength),
            method: central.readUInt16LE(at + 10),
            compressed: central.readUInt32LE(at + 20),
            uncompressed: central.readUInt32LE(at + 24),
            localOffset: central.readUInt32LE(at + 42),
        });
        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** The names of every file and folder in a zip, read from its directory alone; `what` names it in errors ("The save"). */
export async function readZipNames(zipPath: string, what: string): Promise<string[]> {
    const handle = await nodeFs.open(zipPath, "r");
    try {
        return (await zipDirectory(handle, what)).map((entry) => entry.name);
    } finally {
        await handle.close();
    }
}

/**
 * The text of each entry in `names` that the jar has (exact paths, e.g.
 * "plugin.yml" or "META-INF/mods.toml"). A damaged or unsupported jar
 * throws; a missing entry is simply absent from the result.
 */
export async function readJarEntries(jarPath: string, names: readonly string[]): Promise<Map<string, string>> {
    const wanted = new Set(names);
    const found = new Map<string, string>();
    const what = "The jar";
    const handle = await nodeFs.open(jarPath, "r");
    try {
        for (const { name, method, compressed, uncompressed, localOffset } of await zipDirectory(handle, what)) {
            if (found.size === wanted.size) break;
            if (!wanted.has(name) || found.has(name)) continue;
            if (compressed > MAX_JAR_ENTRY_BYTES || uncompressed > MAX_JAR_ENTRY_BYTES) {
                throw new Error(`${name} inside the jar is too large to read.`);
            }

            const local = await readAt(handle, localOffset, 30, what);
            if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error("The jar's zip entries are damaged.");
            const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
            const data = await readAt(handle, dataOffset, compressed, what);
            let bytes: Buffer;
            if (method === 0) bytes = data;
            else if (method === 8) bytes = inflateRawSync(data, { maxOutputLength: MAX_JAR_ENTRY_BYTES });
            else throw new Error(`${name} inside the jar uses a compression Paperboard does not read.`);
            found.set(name, bytes.toString("utf8"));
        }
        return found;
    } finally {
        await handle.close();
    }
}
