// Reads the header of a Terraria .wld file: enough to describe a world in
// the Worlds tab and to tell a world from any other upload. The layout is
// Terraria's WorldFile.SaveWorld_Version2: file metadata, the section
// table, the tile-frame bit array, then the header section with the name,
// seed, size and game mode, followed by the world's flags: its evil, its
// hardmode and the bosses it has seen defeated (WorldFile.SaveWorldFlags).
export interface TerrariaWorldHeader {
    /** the name players see, which can differ from the file name */
    name: string;
    seed: string;
    width: number;
    height: number;
    /** 0 Classic, 1 Expert, 2 Master, 3 Journey */
    gameMode: number;
    evil: "corruption" | "crimson";
    hardmode: boolean;
    /** defeated bosses, in the order players usually meet them */
    bosses: string[];
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
    uint16() { this.need(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
    /** a .NET bool is one byte, 0 or 1; anything else means the layout was misread */
    bool() {
        this.need(1);
        const v = this.bytes[this.offset++];
        if (v > 1) throw new Error("This is not a Terraria world: its flags are damaged");
        return v === 1;
    }
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
    return { name, seed, width, height, gameMode, ...readFlags(read, version) };
}

// Bosses as SaveWorldFlags writes them, by field
const EARLY_BOSSES = ["Eye of Cthulhu", "evil boss", "Skeletron", "Queen Bee", "The Destroyer", "The Twins", "Skeletron Prime", null, "Plantera", "Golem", "King Slime"] as const;
const LATE_BOSSES = ["Duke Fishron", "Martian Saucer", "Lunatic Cultist", "Moon Lord", "Pumpking", "Mourning Wood", "Ice Queen", "Santa-NK1", "Everscream"] as const;
// the order Terraria's progression usually runs, for display
const PROGRESSION = ["King Slime", "Eye of Cthulhu", "Eater of Worlds", "Brain of Cthulhu", "Queen Bee", "Skeletron", "Deerclops", "Queen Slime", "The Destroyer", "The Twins", "Skeletron Prime", "Plantera", "Golem", "Duke Fishron", "Empress of Light", "Lunatic Cultist", "Moon Lord", "Mourning Wood", "Pumpking", "Everscream", "Santa-NK1", "Ice Queen", "Martian Saucer"];

function readFlags(read: Reader, version: number): Pick<TerrariaWorldHeader, "evil" | "hardmode" | "bosses"> {
    const defeated = new Set<string>();
    const bosses = (names: readonly (string | null)[]) => { for (const name of names) if (read.bool() && name) defeated.add(name); };
    // special seed flags, each added in a later release
    for (const added of [222, 227, 238, 239, 241, 249, 266, 267, 302]) if (version >= added) read.bool();
    read.skip(8); // creation time
    if (version >= 284) read.skip(8); // last played
    read.skip(1 + 17 * 4); // moon type; tree and cave background positions and styles
    read.skip(4 + 4 + 8 + 8 + 8); // spawn, surface and rock layers, time
    read.bool(); read.skip(4); read.bool(); read.bool(); // day, moon phase, blood moon, eclipse
    read.skip(4 + 4); // dungeon
    const crimson = read.bool();
    bosses(EARLY_BOSSES);
    for (let i = 0; i < 9; i++) read.bool(); // rescued NPCs, invasions, orbs, meteor
    read.skip(1 + 4); // shadow orbs, altars
    const hardmode = read.bool();
    if (version >= 257) read.bool(); // after party of doom
    read.skip(4 * 3 + 8 + 8 + 1); // invasion, slime rain, sundial
    read.bool(); read.skip(4 + 4 + 4 * 3); // rain; hardmode ores
    read.skip(8 + 4 + 2 + 4); // backgrounds, clouds, wind
    for (let anglers = read.int32(); anglers > 0; anglers--) read.string();
    read.bool(); read.skip(4); read.bool(); read.bool(); read.bool(); read.skip(4 + 4); // angler, stylist, tax collector, golfer, invasion size, cultist delay
    read.skip(read.int16() * 4); // banner kill counts
    if (version >= 289) read.skip(read.int16() * 2); // banner claims
    read.bool(); // fast forward to dawn
    bosses(LATE_BOSSES);
    // the second boss is the world's evil's own
    if (defeated.delete("evil boss")) defeated.add(crimson ? "Brain of Cthulhu" : "Eater of Worlds");
    return { evil: crimson ? "crimson" : "corruption", hardmode, ...laterBosses(read, version, defeated) };
}

function laterBosses(read: Reader, version: number, defeated: Set<string>): { bosses: string[] } {
    for (let i = 0; i < 9; i++) read.bool(); // pillars and the lunar events
    read.bool(); read.bool(); read.skip(4); read.skip(read.int32() * 4); // party
    read.bool(); read.skip(4 + 4 + 4); // sandstorm
    for (let i = 0; i < 4; i++) read.bool(); // tavernkeep and the Old One's Army
    read.skip(5); // more backgrounds
    read.bool(); read.skip(4); read.bool(); read.bool(); read.bool(); // combat book, lantern night
    read.skip(read.int32() * 4); // tree tops
    read.bool(); read.bool(); read.skip(4 * 4); // forced seasons, ore choices
    read.bool(); read.bool(); read.bool(); // town pets
    if (read.bool()) defeated.add("Empress of Light");
    if (read.bool()) defeated.add("Queen Slime");
    if (version >= 240 && read.bool()) defeated.add("Deerclops");
    return { bosses: PROGRESSION.filter((boss) => defeated.has(boss)) };
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
