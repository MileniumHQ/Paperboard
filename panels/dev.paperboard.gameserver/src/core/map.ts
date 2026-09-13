// Top-down map helpers. Pure and testable: the NBT bit-unpacking, the
// heightmap offset rule and the block→color table are the parts most
// likely to be wrong, so they live here with no IO attached.
//
// We parse Anvil chunks ourselves (with prismarine-nbt) rather than
// prismarine-provider-anvil because that stack resolves the world's data
// version through minecraft-data, which does not know newer worlds and
// would drag the whole version database into the panel bundle. Since 1.18
// chunk palettes carry block *names*, a small reader is both smaller and
// version-forward.

export const CHUNK_SIZE = 16;
export const REGION_CHUNKS = 32;
export const REGION_BLOCKS = CHUNK_SIZE * REGION_CHUNKS; // 512 blocks per region tile

export interface RegionCoord {
    x: number;
    z: number;
}

export type MapDimension = "overworld" | "the_nether" | "the_end";

export const MAP_DIMENSIONS: MapDimension[] = [
    "overworld",
    "the_nether",
    "the_end",
];

export const DIMENSION_LABELS: Record<MapDimension, string> = {
    overworld: "Overworld",
    the_nether: "Nether",
    the_end: "The End",
};

// prismarine-nbt represents a TAG_Long as [high, low] signed 32-bit words
export function longPairToBigInt(pair: readonly [number, number]): bigint {
    return (BigInt(pair[0] >>> 0) << 32n) | BigInt(pair[1] >>> 0);
}

// Packed entries, LSB-first within each long, never crossing a long
// boundary (the 1.16+ block-state / 1.18+ heightmap packing).
export function unpackPackedLongs(
    pairs: readonly (readonly [number, number])[],
    bits: number,
    count: number,
): number[] {
    if (!Number.isInteger(bits) || bits <= 0 || bits > 64) {
        throw new Error(`invalid bit width: ${bits}`);
    }
    const perLong = Math.floor(64 / bits);
    const mask = (1n << BigInt(bits)) - 1n;
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) {
        const pair = pairs[Math.floor(i / perLong)];
        const offset = BigInt((i % perLong) * bits);
        out[i] = pair === undefined ? 0 : Number((longPairToBigInt(pair) >> offset) & mask);
    }
    return out;
}

// Heightmap long arrays pack 256 column entries; derive the bit width from
// the array length instead of hardcoding a world height.
export function heightmapBits(longCount: number, entries = 256): number {
    if (longCount <= 0) return 0;
    return Math.floor((longCount * 64) / entries);
}

// Newer worlds store heightmap values relative to the dimension's minimum
// build height: a surface at y=72 with minBuildHeight -64 is stored as 137.
export function surfaceYFromStored(
    stored: number,
    minBuildHeight: number,
): number {
    return stored + minBuildHeight - 1;
}

export function parseRegionFileName(name: string): RegionCoord | null {
    const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name);
    if (!match) return null;
    return { x: Number(match[1]), z: Number(match[2]) };
}

export function regionFileName(coord: RegionCoord): string {
    return `r.${coord.x}.${coord.z}.mca`;
}

const NON_SURFACE_BLOCKS = new Set([
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "minecraft:bedrock",
]);

// The heightmap's top block is not always terrain: in the Nether it is the
// bedrock ceiling, so a naive map is flat grey. A column's real surface is
// the first block that is neither air nor bedrock.
export function isSurfaceBlock(name: string): boolean {
    return !NON_SURFACE_BLOCKS.has(name);
}

// ─── Block colours ───────────────────────────────────────────────────
// A curated surface palette plus suffix rules for everything else. Not
// exhaustive by design — it only has to be recognisable at one pixel per
// block. Values are the top-face averages of the vanilla textures.
const BLOCK_COLORS: Record<string, [number, number, number]> = {
    "minecraft:snow": [240, 240, 242],
    "minecraft:snow_block": [240, 240, 242],
    "minecraft:powder_snow": [248, 250, 252],
    "minecraft:ice": [160, 200, 240],
    "minecraft:packed_ice": [141, 180, 250],
    "minecraft:blue_ice": [116, 167, 253],
    "minecraft:water": [63, 118, 228],
    "minecraft:grass_block": [121, 192, 90],
    "minecraft:dirt": [134, 96, 67],
    "minecraft:coarse_dirt": [119, 85, 59],
    "minecraft:rooted_dirt": [144, 108, 82],
    "minecraft:podzol": [91, 64, 30],
    "minecraft:mud": [60, 60, 70],
    "minecraft:stone": [128, 128, 128],
    "minecraft:cobblestone": [110, 110, 110],
    "minecraft:mossy_cobblestone": [100, 115, 90],
    "minecraft:deepslate": [80, 80, 84],
    "minecraft:tuff": [108, 108, 104],
    "minecraft:gravel": [136, 132, 131],
    "minecraft:andesite": [136, 136, 136],
    "minecraft:diorite": [188, 188, 190],
    "minecraft:granite": [154, 110, 92],
    "minecraft:bedrock": [85, 85, 85],
    "minecraft:sand": [219, 211, 160],
    "minecraft:red_sand": [190, 110, 45],
    "minecraft:sandstone": [216, 203, 155],
    "minecraft:clay": [160, 166, 179],
    "minecraft:terracotta": [152, 94, 67],
    "minecraft:oak_leaves": [63, 111, 42],
    "minecraft:spruce_leaves": [45, 84, 58],
    "minecraft:birch_leaves": [84, 118, 56],
    "minecraft:jungle_leaves": [48, 110, 20],
    "minecraft:acacia_leaves": [110, 130, 30],
    "minecraft:dark_oak_leaves": [50, 86, 30],
    "minecraft:mangrove_leaves": [66, 110, 45],
    "minecraft:cherry_leaves": [226, 170, 197],
    "minecraft:azalea_leaves": [80, 118, 45],
    "minecraft:moss_block": [90, 130, 60],
    "minecraft:grass": [121, 192, 90],
    "minecraft:short_grass": [121, 192, 90],
    "minecraft:tall_grass": [121, 192, 90],
    "minecraft:fern": [100, 160, 70],
    "minecraft:oak_log": [110, 84, 50],
    "minecraft:spruce_log": [60, 45, 26],
    "minecraft:birch_log": [216, 215, 210],
    "minecraft:jungle_log": [86, 68, 30],
    "minecraft:acacia_log": [103, 96, 86],
    "minecraft:dark_oak_log": [60, 46, 26],
    "minecraft:netherrack": [97, 38, 38],
    "minecraft:end_stone": [219, 222, 158],
    "minecraft:obsidian": [20, 18, 29],
    "minecraft:magma_block": [142, 64, 23],
    "minecraft:lava": [207, 92, 23],
    "minecraft:basalt": [73, 73, 77],
    "minecraft:blackstone": [42, 36, 40],
    "minecraft:soul_sand": [81, 62, 50],
    "minecraft:crimson_nylium": [130, 49, 51],
    "minecraft:warped_nylium": [44, 113, 106],
    "minecraft:sugar_cane": [130, 180, 100],
    "minecraft:cactus": [85, 130, 50],
    "minecraft:glowstone": [240, 210, 130],
    "minecraft:sea_lantern": [200, 220, 210],
};

export function blockColor(name: string): [number, number, number] {
    const known = BLOCK_COLORS[name];
    if (known) return known;
    const id = name.startsWith("minecraft:") ? name.slice("minecraft:".length) : name;
    if (id.includes("leaves")) return [63, 111, 42];
    if (id.includes("water")) return [63, 118, 228];
    if (id.includes("snow")) return [240, 240, 242];
    if (id.includes("ice")) return [160, 200, 240];
    if (id.includes("sand")) return [219, 211, 160];
    if (id.includes("terracotta")) return [152, 94, 67];
    if (id.includes("log") || id.includes("wood")) return [110, 84, 50];
    if (id.includes("grass")) return [121, 192, 90];
    if (id.includes("deepslate")) return [80, 80, 84];
    if (id.includes("stone") || id.includes("cobble") || id.includes("andesite")) {
        return [128, 128, 128];
    }
    if (id === "air" || id === "cave_air" || id === "void_air") return [0, 0, 0];
    return [120, 120, 120];
}
