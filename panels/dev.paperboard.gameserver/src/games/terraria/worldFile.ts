// Reads the header of a Terraria .wld file: enough to describe a world in
// the Worlds tab and to tell a world from any other upload. The layout is
// Terraria's WorldFile.SaveWorld_Version2: file metadata, the section
// table, the tile-frame bit array, then the header section with the name,
// seed, size and game mode.
export interface TerrariaWorldHeader {
    /** the name players see, which can differ from the file name */
    name: string;
    seed: string;
    width: number;
    height: number;
    /** 0 Classic, 1 Expert, 2 Master, 3 Journey */
    gameMode: number;
}

// "relogic" as the low 56 bits of a little-endian uint64; file type 2 is a world
const MAGIC = 0x6369676f6c6572n;
const WORLD_FILE_TYPE = 2n;
// the oldest release with a seed, generator version and game mode in the header (1.4.0)
const OLDEST_VERSION = 225;

class Reader {
    offset = 0;
    constructor(private readonly view: DataView, private readonly bytes: Uint8Array) {}
    private need(n: number) {
        if (this.offset + n > this.view.byteLength) throw new Error("This is not a Terraria world: the file ends early");
    }
    int16() { this.need(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
    int32() { this.need(4); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
    uint64() { this.need(8); const v = this.view.getBigUint64(this.offset, true); this.offset += 8; return v; }
    skip(n: number) { this.need(n); this.offset += n; }
    /** a .NET BinaryWriter string: 7-bit encoded length, then UTF-8 */
    string() {
        let length = 0;
        for (let shift = 0; ; shift += 7) {
            if (shift > 28) throw new Error("This is not a Terraria world: a text field is malformed");
            this.need(1);
            const byte = this.bytes[this.offset++];
            length |= (byte & 0x7f) << shift;
            if (!(byte & 0x80)) break;
        }
        this.need(length);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(this.offset, this.offset + length));
        this.offset += length;
        return text;
    }
}

export function readWorldHeader(bytes: Uint8Array): TerrariaWorldHeader {
    const read = new Reader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes);
    const version = read.int32();
    const signature = read.uint64();
    if ((signature & 0xffffffffffffffn) !== MAGIC || signature >> 56n !== WORLD_FILE_TYPE) throw new Error("This is not a Terraria world file");
    if (version < OLDEST_VERSION) throw new Error(`This world is from an old Terraria release (file version ${version}); open it in Terraria 1.4 or later first`);
    read.skip(4 + 8); // revision, favorite flags
    const sections = read.int16();
    if (sections < 1) throw new Error("This is not a Terraria world: it has no sections");
    const headerAt = read.int32(); // the header is the first section
    read.offset = headerAt;
    const name = read.string();
    const seed = read.string();
    read.skip(8 + 16 + 4 + 16); // generator version, unique id, world id, bounds
    const height = read.int32();
    const width = read.int32();
    const gameMode = read.int32();
    if (width <= 0 || height <= 0 || gameMode < 0 || gameMode > 3) throw new Error("This is not a Terraria world: its header is damaged");
    return { name, seed, width, height, gameMode };
}

/** Terraria's three preset sizes by width; anything else is a custom size */
export function worldSizeLabel(width: number): string {
    switch (width) {
        case 4200: return "Small";
        case 6400: return "Medium";
        case 8400: return "Large";
        default: return `${width} wide`;
    }
}

export function gameModeLabel(mode: number): string {
    return ["Classic", "Expert", "Master", "Journey"][mode] ?? `Mode ${mode}`;
}
