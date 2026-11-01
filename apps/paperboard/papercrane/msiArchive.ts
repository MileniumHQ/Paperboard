// Windows Installer packages (.msi) as package recipe archives: the
// cabinets an MSI carries inside itself, unpacked without msiexec. An
// administrative install (msiexec /a) needs the Windows Installer service,
// which a standard user's non-interactive session cannot reach, and only
// runs on Windows; reading the file needs neither.
//
// An MSI is a compound file (the OLE structured storage format) whose
// streams include its cabinets. Each cabinet's members are named by the
// MSI's File table keys (e.g. Microsoft_Xna_Framework_dll_GAC), so a
// recipe takes members by those keys. Only MSZIP and uncompressed
// cabinets are read; anything else is refused, never guessed.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { TAR_BUDGET } from "./storage";

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const MAX_REGULAR = 0xfffffffa;
const STREAM = 2;
const ROOT = 5;

function fail(message: string): never {
    throw new Error(`Not a readable Windows Installer package: ${message}`);
}

/** every stream of a compound file, by directory order */
export function compoundStreams(file: Buffer): Buffer[] {
    if (file.length < 512 || !file.subarray(0, 8).equals(CFB_MAGIC)) fail("no compound file header");
    const sectorShift = file.readUInt16LE(30);
    const miniShift = file.readUInt16LE(32);
    if ((sectorShift !== 9 && sectorShift !== 12) || miniShift !== 6) fail(`unsupported sector sizes 2^${sectorShift}/2^${miniShift}`);
    const sectorSize = 1 << sectorShift;
    const sectorCount = Math.floor((file.length - sectorSize) / sectorSize) + 1;
    const sector = (id: number) => {
        if (id > MAX_REGULAR || id >= sectorCount) fail(`sector ${id} is outside the file`);
        const start = (id + 1) * sectorSize;
        return file.subarray(start, Math.min(start + sectorSize, file.length));
    };

    // the FAT's own sectors: 109 listed in the header, the rest in a DIFAT chain
    const fatSectors: number[] = [];
    const fatCount = file.readUInt32LE(44);
    for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(file.readUInt32LE(76 + i * 4));
    let difat = file.readUInt32LE(68);
    for (let hops = 0; fatSectors.length < fatCount; hops++) {
        if (difat === END_OF_CHAIN || difat === FREE || hops > sectorCount) fail("its sector table list ends early");
        const block = sector(difat);
        const perBlock = sectorSize / 4 - 1;
        for (let i = 0; i < perBlock && fatSectors.length < fatCount; i++) fatSectors.push(block.readUInt32LE(i * 4));
        difat = block.readUInt32LE(perBlock * 4);
    }
    const fat: number[] = [];
    for (const id of fatSectors) {
        const block = sector(id);
        for (let i = 0; i + 4 <= block.length; i += 4) fat.push(block.readUInt32LE(i));
    }

    const chain = (table: number[], start: number, limit: number): number[] => {
        const ids: number[] = [];
        for (let id = start; id !== END_OF_CHAIN; id = table[id]!) {
            if (id >= table.length || ids.length >= limit) fail("a sector chain loops or leaves the file");
            ids.push(id);
        }
        return ids;
    };
    const read = (start: number, size: number) => {
        const ids = chain(fat, start, sectorCount);
        if (ids.length * sectorSize < size) fail("a stream is shorter than its size");
        return Buffer.concat(ids.map(sector)).subarray(0, size);
    };

    const dirStart = file.readUInt32LE(48);
    const dir = Buffer.concat(chain(fat, dirStart, sectorCount).map(sector));
    const entries: { type: number; start: number; size: number }[] = [];
    for (let at = 0; at + 128 <= dir.length; at += 128) {
        const type = dir[at + 66]!;
        // the high half of the size only counts in 4096-byte-sector files
        const size = dir.readUInt32LE(at + 120) + (sectorShift === 12 ? dir.readUInt32LE(at + 124) * 2 ** 32 : 0);
        entries.push({ type, start: dir.readUInt32LE(at + 116), size });
    }
    const root = entries[0];
    if (!root || root.type !== ROOT) fail("no root entry");

    const cutoff = file.readUInt32LE(56);
    const miniStream = root.size > 0 ? read(root.start, root.size) : Buffer.alloc(0);
    const miniFat: number[] = [];
    const miniFatStart = file.readUInt32LE(60);
    if (miniFatStart !== END_OF_CHAIN && file.readUInt32LE(64) > 0) {
        const block = read(miniFatStart, file.readUInt32LE(64) * sectorSize);
        for (let i = 0; i + 4 <= block.length; i += 4) miniFat.push(block.readUInt32LE(i));
    }
    const readMini = (start: number, size: number) => {
        const ids = chain(miniFat, start, miniStream.length / 64 + 1);
        const out = Buffer.concat(ids.map((id) => {
            if ((id + 1) * 64 > miniStream.length) fail("a small stream is outside the mini stream");
            return miniStream.subarray(id * 64, (id + 1) * 64);
        }));
        if (out.length < size) fail("a small stream is shorter than its size");
        return out.subarray(0, size);
    };

    let total = 0;
    return entries.filter((e) => e.type === STREAM).map((e) => {
        total += e.size;
        if (total > file.length) fail("its streams are larger than the file");
        return e.size < cutoff ? readMini(e.start, e.size) : read(e.start, e.size);
    });
}

const CAB_MAGIC = Buffer.from("MSCF");
const PREV_CABINET = 0x1;
const NEXT_CABINET = 0x2;
const RESERVE_PRESENT = 0x4;
const NAME_IS_UTF = 0x80;
const WINDOW = 32 * 1024;

export interface CabinetMember { name: string; data: Buffer }

/** every member of one self-contained cabinet (no spanning), MSZIP or stored */
export function cabinetMembers(cab: Buffer, budget = { bytes: TAR_BUDGET.maxBytes, entries: TAR_BUDGET.maxEntries }): CabinetMember[] {
    const bad = (message: string): never => fail(`its cabinet ${message}`);
    if (cab.length < 36 || !cab.subarray(0, 4).equals(CAB_MAGIC)) bad("has no header");
    const filesAt = cab.readUInt32LE(16);
    const folderCount = cab.readUInt16LE(26);
    const fileCount = cab.readUInt16LE(28);
    const flags = cab.readUInt16LE(30);
    if (flags & (PREV_CABINET | NEXT_CABINET)) bad("spans several cabinets");
    if (fileCount > budget.entries) bad(`has ${fileCount} members, more than ${budget.entries}`);
    let at = 36;
    let folderReserve = 0;
    let dataReserve = 0;
    if (flags & RESERVE_PRESENT) {
        const headerReserve = cab.readUInt16LE(36);
        folderReserve = cab[38]!;
        dataReserve = cab[39]!;
        at = 40 + headerReserve;
    }

    // each folder is one compressed stream of its members, back to back
    const folders: Buffer[] = [];
    let unpacked = 0;
    for (let f = 0; f < folderCount; f++, at += 8 + folderReserve) {
        if (at + 8 > cab.length) bad("ends inside its folder list");
        let block = cab.readUInt32LE(at);
        const blocks = cab.readUInt16LE(at + 4);
        const method = cab.readUInt16LE(at + 6) & 0xf;
        if (method !== 0 && method !== 1) bad(`uses compression ${method}, which only MSZIP (1) and none (0) are read for`);
        const parts: Buffer[] = [];
        let window = Buffer.alloc(0);
        for (let b = 0; b < blocks; b++) {
            if (block + 8 + dataReserve > cab.length) bad("ends inside a data block header");
            const packed = cab.readUInt16LE(block + 4);
            const size = cab.readUInt16LE(block + 6);
            const start = block + 8 + dataReserve;
            if (start + packed > cab.length) bad("ends inside a data block");
            const data = cab.subarray(start, start + packed);
            let out: Buffer;
            if (method === 0) {
                out = data;
            } else {
                if (data[0] !== 0x43 || data[1] !== 0x4b) bad("has an MSZIP block without its CK signature");
                // each block is its own deflate stream over the folder's last 32 KB
                out = zlib.inflateRawSync(data.subarray(2), { dictionary: window, finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: WINDOW });
            }
            if (out.length !== size) bad(`has a block that unpacks to ${out.length} bytes, not ${size}`);
            unpacked += size;
            if (unpacked > budget.bytes) bad(`unpacks to more than ${budget.bytes} bytes`);
            parts.push(out);
            window = Buffer.concat([window, out]);
            if (window.length > WINDOW) window = window.subarray(window.length - WINDOW);
            block = start + packed;
        }
        folders.push(Buffer.concat(parts));
    }

    const members: CabinetMember[] = [];
    at = filesAt;
    for (let i = 0; i < fileCount; i++) {
        if (at + 16 > cab.length) bad("ends inside its member list");
        const size = cab.readUInt32LE(at);
        const offset = cab.readUInt32LE(at + 4);
        const folder = cab.readUInt16LE(at + 8);
        const attribs = cab.readUInt16LE(at + 14);
        const nameEnd = cab.indexOf(0, at + 16);
        if (nameEnd < 0) bad("ends inside a member name");
        const name = cab.subarray(at + 16, nameEnd).toString(attribs & NAME_IS_UTF ? "utf8" : "latin1");
        at = nameEnd + 1;
        const source = folders[folder];
        if (!source) bad(`puts ${name} in folder ${folder}, which it doesn't have`);
        if (offset + size > source.length) bad(`has ${name} running past its folder`);
        members.push({ name, data: source.subarray(offset, offset + size) });
    }
    return members;
}

const SEGMENT_RE = /^[A-Za-z0-9 _+.,@()-]+$/;

/** an MSI's cabinets, unpacked into dest by member name */
export async function extractMsi(msiPath: string, dest: string): Promise<void> {
    const file = await fs.promises.readFile(msiPath);
    const cabinets = compoundStreams(file).filter((stream) => stream.subarray(0, 4).equals(CAB_MAGIC));
    if (cabinets.length === 0) fail("it carries no cabinet (its files would be beside it, which a package download doesn't have)");
    let bytes = TAR_BUDGET.maxBytes;
    let entries = TAR_BUDGET.maxEntries;
    for (const cab of cabinets) {
        const members = cabinetMembers(cab, { bytes, entries });
        for (const member of members) {
            const segments = member.name.split("\\");
            for (const segment of segments) {
                if (!SEGMENT_RE.test(segment) || segment === "." || segment === "..") fail(`a member has an unsafe name ${JSON.stringify(member.name)}`);
            }
            const to = path.join(dest, ...segments);
            if (fs.existsSync(to)) fail(`it has two members named ${member.name}`);
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            await fs.promises.writeFile(to, member.data);
            bytes -= member.data.length;
        }
        entries -= members.length;
    }
}
