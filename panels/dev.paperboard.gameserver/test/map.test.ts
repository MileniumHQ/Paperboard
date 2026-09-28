// Map parsing helpers (bun test): the bit-unpacking and heightmap offset
// rules are the parts most likely to silently produce a wrong map, so they
// are pinned against a real chunk's bytes.
import { describe, test, expect } from "bun:test";
import {
    blockColor,
    heightmapBits,
    isSurfaceBlock,
    longPairToBigInt,
    paletteEntryName,
    parseRegionFileName,
    regionFileName,
    sectionLayerIndex,
    surfaceYFromStored,
    unpackPackedLongs,
} from "../src/core/map";

describe("longPairToBigInt", () => {
    test("joins high and low 32-bit words", () => {
        expect(longPairToBigInt([0, 1])).toBe(1n);
        expect(longPairToBigInt([1, 0])).toBe(1n << 32n);
    });
});

describe("unpackPackedLongs", () => {
    test("decodes the first heightmap longs of a real chunk", () => {
        // WORLD_SURFACE[0..1] from r.0.0.mca (9-bit packing, no crossing)
        expect(unpackPackedLongs([[554731604, 841290377]], 9, 2)).toEqual([
            137, 137,
        ]);
    });

    test("rejects an invalid bit width", () => {
        expect(() => unpackPackedLongs([[0, 0]], 0, 1)).toThrow(/bit width/);
        expect(() => unpackPackedLongs([[0, 0]], 65, 1)).toThrow(/bit width/);
    });
});

describe("heightmapBits", () => {
    test("derives bit width from the long-array length", () => {
        expect(heightmapBits(37)).toBe(9);
        expect(heightmapBits(32)).toBe(8);
        expect(heightmapBits(0)).toBe(0);
    });
});

describe("surfaceYFromStored", () => {
    test("applies the minimum build height offset", () => {
        expect(surfaceYFromStored(137, -64)).toBe(72);
        expect(surfaceYFromStored(65, -64)).toBe(0);
    });
});

describe("paletteEntryName", () => {
    test("reads every palette shape Minecraft has shipped", () => {
        // 1.18–1.21.x compound form
        expect(paletteEntryName({ Name: "minecraft:oak_log" })).toBe(
            "minecraft:oak_log",
        );
        // newer compound form: `id` with inlined properties
        expect(
            paletteEntryName({
                id: "minecraft:glow_lichen",
                properties: { north: "true" },
            }),
        ).toBe("minecraft:glow_lichen");
        // property-less blocks compress to an empty key
        expect(paletteEntryName({ "": "minecraft:air" })).toBe("minecraft:air");
        // 26.x stores bare name strings
        expect(paletteEntryName("minecraft:deepslate")).toBe(
            "minecraft:deepslate",
        );
        // unknown shapes must not be mistaken for a real block
        expect(paletteEntryName(undefined)).toBe("minecraft:air");
        expect(paletteEntryName({})).toBe("minecraft:air");
    });
});

describe("sectionLayerIndex", () => {
    test("wraps negative world y into the section layer", () => {
        expect(sectionLayerIndex(0)).toBe(0);
        expect(sectionLayerIndex(15)).toBe(15);
        expect(sectionLayerIndex(16)).toBe(0);
        expect(sectionLayerIndex(-1)).toBe(15);
        expect(sectionLayerIndex(-16)).toBe(0);
        expect(sectionLayerIndex(-64)).toBe(0);
    });
});

describe("region file names", () => {
    test("parses and formats region coordinates", () => {
        expect(parseRegionFileName("r.0.0.mca")).toEqual({ x: 0, z: 0 });
        expect(parseRegionFileName("r.-3.12.mca")).toEqual({ x: -3, z: 12 });
        expect(parseRegionFileName("level.dat")).toBeNull();
        expect(regionFileName({ x: -3, z: 12 })).toBe("r.-3.12.mca");
    });
});

describe("blockColor", () => {
    test("uses known colours and sensible fallbacks", () => {
        expect(blockColor("minecraft:water")).toEqual([63, 118, 228]);
        expect(blockColor("minecraft:packed_ice")).toEqual([141, 180, 250]);
        expect(blockColor("minecraft:some_leaves")).toEqual([63, 111, 42]);
        expect(blockColor("minecraft:mystery_block")).toEqual([120, 120, 120]);
    });
});

describe("isSurfaceBlock", () => {
    test("treats air variants and bedrock as non-surface", () => {
        for (const name of [
            "minecraft:air",
            "minecraft:cave_air",
            "minecraft:void_air",
            "minecraft:bedrock",
        ]) {
            expect(isSurfaceBlock(name)).toBe(false);
        }
    });

    test("accepts real surface blocks (netherrack/end_stone are the nether/end surfaces)", () => {
        for (const name of [
            "minecraft:netherrack",
            "minecraft:end_stone",
            "minecraft:grass_block",
            "minecraft:water",
        ]) {
            expect(isSurfaceBlock(name)).toBe(true);
        }
    });
});
