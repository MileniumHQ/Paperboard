import * as nodeFs from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

// Reads a few small named files out of a jar without unpacking it: the zip's
// central directory is read from the end of the file, then only the wanted
// entries. Everything is capped, so a huge or hostile jar costs at most a
// few megabytes.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
export const MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024;
export const MAX_JAR_ENTRY_BYTES = 1024 * 1024;

async function readAt(handle: nodeFs.FileHandle, position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead !== length) throw new Error("The jar ends early; it may be damaged.");
    return buffer;
}

/**
 * The text of each entry in `names` that the jar has (exact paths, e.g.
 * "plugin.yml" or "META-INF/mods.toml"). A damaged or unsupported jar
 * throws; a missing entry is simply absent from the result.
 */
export async function readJarEntries(jarPath: string, names: readonly string[]): Promise<Map<string, string>> {
    const wanted = new Set(names);
    const found = new Map<string, string>();
    const handle = await nodeFs.open(jarPath, "r");
    try {
        const { size } = await handle.stat();
        if (size < EOCD_MIN) throw new Error("The jar is too small to be a jar.");
        const tailLength = Math.min(size, EOCD_MIN + MAX_COMMENT);
        const tail = await readAt(handle, size - tailLength, tailLength);
        let eocd = -1;
        for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
            if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0) throw new Error("The jar has no zip directory; it may be damaged.");
        const centralSize = tail.readUInt32LE(eocd + 12);
        const centralOffset = tail.readUInt32LE(eocd + 16);
        if (centralOffset === 0xffffffff || centralSize === 0xffffffff) {
            throw new Error("The jar uses a zip format Paperboard does not read (zip64).");
        }
        if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) throw new Error("The jar's file list is too large to read.");
        if (centralOffset + centralSize > size) throw new Error("The jar's zip directory points past its end.");
        const central = await readAt(handle, centralOffset, centralSize);

        let at = 0;
        while (at + 46 <= central.length && found.size < wanted.size) {
            if (central.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error("The jar's zip directory is damaged.");
            const method = central.readUInt16LE(at + 10);
            const compressed = central.readUInt32LE(at + 20);
            const uncompressed = central.readUInt32LE(at + 24);
            const nameLength = central.readUInt16LE(at + 28);
            const extraLength = central.readUInt16LE(at + 30);
            const commentLength = central.readUInt16LE(at + 32);
            const localOffset = central.readUInt32LE(at + 42);
            const name = central.toString("utf8", at + 46, at + 46 + nameLength);
            at += 46 + nameLength + extraLength + commentLength;
            if (!wanted.has(name) || found.has(name)) continue;
            if (compressed > MAX_JAR_ENTRY_BYTES || uncompressed > MAX_JAR_ENTRY_BYTES) {
                throw new Error(`${name} inside the jar is too large to read.`);
            }

            const local = await readAt(handle, localOffset, 30);
            if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error("The jar's zip entries are damaged.");
            const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
            const data = await readAt(handle, dataOffset, compressed);
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
