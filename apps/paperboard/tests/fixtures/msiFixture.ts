// Builds small Windows Installer files for tests: a compound file (version
// 3, 512-byte sectors) holding a cabinet stream and a small stream that
// lives in the mini stream, as a real MSI's tables do. The cabinet packs
// its members into one folder, MSZIP-compressed in 32 KB blocks that each
// reach back into the one before, like makecab's.
import zlib from "node:zlib";

const SECTOR = 512;
const FREE = 0xffffffff;
const END = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const NONE = 0xffffffff;

export interface CabMember { name: string; data: Buffer }

/** compression: 1 = MSZIP, 0 = stored; any other number is written as-is (for refusals) */
export function buildCabinet(members: CabMember[], compression = 1): Buffer {
    const folderData = Buffer.concat(members.map((m) => m.data));
    const blocks: Buffer[] = [];
    let window = Buffer.alloc(0);
    for (let at = 0; at < folderData.length || blocks.length === 0; at += 32768) {
        const chunk = folderData.subarray(at, at + 32768);
        const packed = compression === 1
            ? Buffer.concat([Buffer.from("CK"), zlib.deflateRawSync(chunk, { dictionary: window })])
            : chunk;
        const header = Buffer.alloc(8);
        header.writeUInt32LE(0, 0); // no checksum
        header.writeUInt16LE(packed.length, 4);
        header.writeUInt16LE(chunk.length, 6);
        blocks.push(Buffer.concat([header, packed]));
        window = Buffer.concat([window, chunk]).subarray(-32768);
    }
    const entries = members.map((m, i) => {
        const offset = members.slice(0, i).reduce((n, x) => n + x.data.length, 0);
        const head = Buffer.alloc(16);
        head.writeUInt32LE(m.data.length, 0);
        head.writeUInt32LE(offset, 4);
        head.writeUInt16LE(0, 8); // folder
        head.writeUInt16LE(0x5b21, 10); // a date
        head.writeUInt16LE(0, 12);
        head.writeUInt16LE(0x20, 14); // archive attribute
        return Buffer.concat([head, Buffer.from(m.name, "latin1"), Buffer.from([0])]);
    });
    const filesAt = 36 + 8;
    const dataAt = filesAt + entries.reduce((n, e) => n + e.length, 0);
    const total = dataAt + blocks.reduce((n, b) => n + b.length, 0);
    const header = Buffer.alloc(36);
    header.write("MSCF", 0, "latin1");
    header.writeUInt32LE(total, 8);
    header.writeUInt32LE(filesAt, 16);
    header[24] = 3;
    header[25] = 1;
    header.writeUInt16LE(1, 26); // folders
    header.writeUInt16LE(members.length, 28);
    const folder = Buffer.alloc(8);
    folder.writeUInt32LE(dataAt, 0);
    folder.writeUInt16LE(blocks.length, 4);
    folder.writeUInt16LE(compression, 6);
    return Buffer.concat([header, folder, ...entries, ...blocks]);
}

function pad(buf: Buffer): Buffer {
    const size = Math.ceil(buf.length / SECTOR) * SECTOR;
    return Buffer.concat([buf, Buffer.alloc(size - buf.length)]);
}

function dirEntry(name: string, type: number, start: number, size: number, right = NONE, child = NONE): Buffer {
    const e = Buffer.alloc(128);
    e.write(name, 0, "utf16le");
    e.writeUInt16LE((name.length + 1) * 2, 64);
    e[66] = type;
    e[67] = 1; // black
    e.writeUInt32LE(NONE, 68);
    e.writeUInt32LE(right, 72);
    e.writeUInt32LE(child, 76);
    e.writeUInt32LE(start, 116);
    e.writeUInt32LE(size, 120);
    return e;
}

/** a compound file with these streams, in order; streams under 4096 bytes go in the mini stream */
export function buildCompoundFile(streams: { name: string; data: Buffer }[]): Buffer {
    const small = streams.filter((s) => s.data.length < 4096);
    const large = streams.filter((s) => s.data.length >= 4096);

    // mini stream: 64-byte sectors, chained in the mini FAT
    const miniFat: number[] = [];
    const miniParts: Buffer[] = [];
    const miniStart = new Map<string, number>();
    for (const s of small) {
        const count = Math.max(1, Math.ceil(s.data.length / 64));
        miniStart.set(s.name, miniFat.length);
        for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? END : miniFat.length + 1);
        miniParts.push(Buffer.concat([s.data, Buffer.alloc(count * 64 - s.data.length)]));
    }
    const miniStream = Buffer.concat(miniParts);

    // regular sectors: directory, mini FAT, mini stream, large streams, then the FAT
    const dirSectors = Math.ceil(((streams.length + 1) * 128) / SECTOR);
    const miniFatBytes = Buffer.alloc(Math.max(SECTOR, Math.ceil((miniFat.length * 4) / SECTOR) * SECTOR), 0xff);
    miniFat.forEach((v, i) => miniFatBytes.writeUInt32LE(v, i * 4));
    const chunks: { bytes: Buffer; sectors: number }[] = [];
    const place = (bytes: Buffer) => {
        const padded = pad(bytes);
        const start = chunks.reduce((n, c) => n + c.sectors, 0);
        chunks.push({ bytes: padded, sectors: padded.length / SECTOR });
        return start;
    };
    const dirStart = place(Buffer.alloc(dirSectors * SECTOR));
    const miniFatStart = small.length ? place(miniFatBytes) : END;
    const miniStreamStart = small.length ? place(miniStream) : END;
    const largeStart = new Map<string, number>();
    for (const s of large) largeStart.set(s.name, place(s.data));
    const dataSectors = chunks.reduce((n, c) => n + c.sectors, 0);
    let fatSectors = 1;
    while ((dataSectors + fatSectors) > fatSectors * (SECTOR / 4)) fatSectors++;
    if (fatSectors > 109) throw new Error("fixture too large for a header-only DIFAT");

    const fat = new Array<number>(fatSectors * (SECTOR / 4)).fill(FREE);
    const chain = (start: number, sectors: number) => {
        for (let i = 0; i < sectors; i++) fat[start + i] = i === sectors - 1 ? END : start + i + 1;
    };
    let at = 0;
    for (const c of chunks) {
        chain(at, c.sectors);
        at += c.sectors;
    }
    for (let i = 0; i < fatSectors; i++) fat[dataSectors + i] = FAT_SECTOR;

    const dir = Buffer.concat([
        dirEntry("Root Entry", 5, small.length ? miniStreamStart : END, miniStream.length, NONE, streams.length ? 1 : NONE),
        ...streams.map((s, i) => dirEntry(s.name, 2, s.data.length < 4096 ? miniStart.get(s.name)! : largeStart.get(s.name)!, s.data.length, i + 2 <= streams.length ? i + 2 : NONE)),
    ]);
    // placed padded copies, so the directory is written into its own sectors
    const dirSlot = chunks[0]!.bytes;
    dir.copy(dirSlot);
    for (let i = dir.length; i + 128 <= dirSlot.length; i += 128) {
        dirSlot.writeUInt32LE(NONE, i + 68);
        dirSlot.writeUInt32LE(NONE, i + 72);
        dirSlot.writeUInt32LE(NONE, i + 76);
    }

    const header = Buffer.alloc(SECTOR);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
    header.writeUInt16LE(0x3e, 24);
    header.writeUInt16LE(3, 26);
    header.writeUInt16LE(0xfffe, 28);
    header.writeUInt16LE(9, 30);
    header.writeUInt16LE(6, 32);
    header.writeUInt32LE(fatSectors, 44);
    header.writeUInt32LE(dirStart, 48);
    header.writeUInt32LE(4096, 56);
    header.writeUInt32LE(miniFatStart, 60);
    header.writeUInt32LE(small.length ? miniFatBytes.length / SECTOR : 0, 64);
    header.writeUInt32LE(END, 68);
    header.writeUInt32LE(0, 72);
    for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? dataSectors + i : FREE, 76 + i * 4);
    const fatBytes = Buffer.alloc(fatSectors * SECTOR);
    fat.forEach((v, i) => fatBytes.writeUInt32LE(v >>> 0, i * 4));
    return Buffer.concat([header, ...chunks.map((c) => c.bytes), fatBytes]);
}

/** an MSI-shaped file: a small table stream and one cabinet of these members */
export function buildMsi(members: CabMember[], compression = 1): Buffer {
    return buildCompoundFile([
        { name: "StringPool", data: Buffer.from("tables live in small streams") },
        { name: "product.cab", data: buildCabinet(members, compression) },
    ]);
}
