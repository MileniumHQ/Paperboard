import * as fs from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { PNG } from "pngjs";
import { files as fileApi, type ServiceContext } from "@paperboard-dev/paperapi";
import { listDirectory } from "../lib/filesystem";
import {
    blockColor,
    heightmapBits,
    isSurfaceBlock,
    parseRegionFileName,
    regionFileName,
    surfaceYFromStored,
    unpackPackedLongs,
    MAP_DIMENSIONS,
    REGION_BLOCKS,
    REGION_CHUNKS,
    CHUNK_SIZE,
    type MapDimension,
    type RegionCoord,
} from "../core/map";
import { type GameServerState, PANEL_ID } from "./types";
import { resolveLevelName } from "./worlds";

// Minimum build height per dimension: heightmap values are stored relative
// to it (overworld surface y=72 with a -64 floor is stored as 137; nether
// and end floors are 0). Wrong by 16 → map is wrong by a multiple of 16.
const DIMENSION_MIN_BUILD: Record<MapDimension, number> = {
    overworld: -64,
    the_nether: 0,
    the_end: 0,
};

export interface MapDimensionRegions {
    dimension: MapDimension;
    regions: RegionCoord[];
}

export interface MapRegionsResult {
    levelName: string;
    dimensions: MapDimensionRegions[];
}

interface Section {
    Y: number;
    block_states?: {
        palette?: { Name: string }[];
        data?: [number, number][];
    };
}

interface ChunkNbt {
    Status?: string;
    sections?: Section[];
    Heightmaps?: Record<string, [number, number][]>;
}

// new worlds nest dimensions under dimensions/minecraft/<id>/region; older
// ones use the world root / DIM-1 / DIM1. Check modern first.
function regionDirCandidates(levelName: string, dimension: MapDimension): string[] {
    const modern = `${levelName}/dimensions/minecraft/${dimension}/region`;
    switch (dimension) {
        case "overworld":
            return [modern, `${levelName}/region`];
        case "the_nether":
            return [modern, `${levelName}/DIM-1/region`];
        case "the_end":
            return [modern, `${levelName}/DIM1/region`];
    }
}

async function resolveRegionDir(
    levelName: string,
    dimension: MapDimension,
): Promise<string | null> {
    for (const candidate of regionDirCandidates(levelName, dimension)) {
        try {
            if (await fileApi.exists(candidate, PANEL_ID)) return candidate;
        } catch (err) {
            console.debug(`[Service:Map] region dir probe failed for "${candidate}":`, String(err));
        }
    }
    return null;
}

const DIMENSION_ORDER = MAP_DIMENSIONS;

export async function listMapRegions(
    _ctx: ServiceContext<GameServerState>,
): Promise<MapRegionsResult> {
    const levelName = await resolveLevelName();
    const dimensions: MapDimensionRegions[] = [];
    for (const dimension of DIMENSION_ORDER) {
        const dir = await resolveRegionDir(levelName, dimension);
        if (!dir) continue;
        const regions: RegionCoord[] = [];
        for (const entry of await listDirectory(dir)) {
            const coord = parseRegionFileName(entry);
            if (coord) regions.push(coord);
        }
        if (regions.length === 0) continue;
        regions.sort((a, b) => a.x - b.x || a.z - b.z);
        dimensions.push({ dimension, regions });
    }
    return { levelName, dimensions };
}

function blockNameAt(sections: Map<number, Section>, x: number, y: number, z: number): string {
    const section = sections.get(Math.floor(y / 16));
    const palette = section?.block_states?.palette;
    if (!palette || palette.length === 0) return "minecraft:air";
    if (palette.length === 1 || !section?.block_states?.data) {
        return palette[0]?.Name ?? "minecraft:air";
    }
    const bits = Math.max(4, Math.ceil(Math.log2(palette.length)));
    const perLong = Math.floor(64 / bits);
    const index = (y % 16) * 256 + z * CHUNK_SIZE + x;
    const value = Number(
        (longPair(section.block_states.data[Math.floor(index / perLong)]) >>
            BigInt((index % perLong) * bits)) &
            ((1n << BigInt(bits)) - 1n),
    );
    return palette[value]?.Name ?? "minecraft:air";
}

// WORLD_SURFACE is the topmost non-air block, which in the Nether is the
// bedrock ceiling — so walk down to the first real surface block (see
// isSurfaceBlock). Overworld/End surfaces return on the first step. Bounded
// so a column full of air cannot scan the whole world.
const MAX_SURFACE_SCAN = 160;

function surfaceBlockAt(
    sections: Map<number, Section>,
    x: number,
    startY: number,
    z: number,
    minBuildHeight: number,
): string {
    const floor = minBuildHeight;
    for (let y = startY; y >= floor && y > startY - MAX_SURFACE_SCAN; y--) {
        const name = blockNameAt(sections, x, y, z);
        if (isSurfaceBlock(name)) return name;
    }
    return "minecraft:air";
}

// prismarine-nbt long arrays are [high, low] pairs; local so the hot loop
// avoids re-importing the core helper with its type gymnastics
function longPair(pair: [number, number] | undefined): bigint {
    if (!pair) return 0n;
    return (BigInt(pair[0] >>> 0) << 32n) | BigInt(pair[1] >>> 0);
}

async function parseChunk(buffer: Buffer): Promise<ChunkNbt | null> {
    try {
        const parsed = await nbt.parse(buffer);
        return nbt.simplify(parsed.parsed) as ChunkNbt;
    } catch (err) {
        console.debug("[Service:Map] chunk NBT parse failed:", String(err));
        return null;
    }
}

interface CachedTile {
    mtimeMs: number;
    dataUrl: string;
}

// Bounded tile cache: maps change under us, so entries are invalidated by
// the region file's mtime, and the map never grows past CACHE_MAX.
const CACHE_MAX = 48;
const tileCache = new Map<string, CachedTile>();

function cacheSet(key: string, value: CachedTile): void {
    tileCache.delete(key);
    tileCache.set(key, value);
    while (tileCache.size > CACHE_MAX) {
        const oldest = tileCache.keys().next().value;
        if (oldest === undefined) break;
        tileCache.delete(oldest);
    }
}

export interface RenderedTile {
    dataUrl: string;
    dimension: MapDimension;
    rx: number;
    rz: number;
}

export async function renderMapTile(
    _ctx: ServiceContext<GameServerState>,
    dimension: MapDimension,
    rx: number,
    rz: number,
): Promise<RenderedTile | null> {
    if (!DIMENSION_ORDER.includes(dimension)) {
        throw new Error(`Unknown dimension: ${JSON.stringify(dimension)}`);
    }
    if (!Number.isInteger(rx) || !Number.isInteger(rz)) {
        throw new Error("Invalid region coordinates");
    }
    const levelName = await resolveLevelName();
    const dir = await resolveRegionDir(levelName, dimension);
    if (!dir) throw new Error(`No region directory for dimension ${dimension}`);

    const relative = `${dir}/${regionFileName({ x: rx, z: rz })}`;
    if (!(await fileApi.exists(relative, PANEL_ID))) return null;
    const absolute = await fileApi.getPath(relative, PANEL_ID);
    const mtimeMs = fs.statSync(absolute).mtimeMs;

    const cached = tileCache.get(absolute);
    if (cached && cached.mtimeMs === mtimeMs) {
        return { dataUrl: cached.dataUrl, dimension, rx, rz };
    }

    const buffer = fs.readFileSync(absolute);
    const png = new PNG({ width: REGION_BLOCKS, height: REGION_BLOCKS });
    const minBuildHeight = DIMENSION_MIN_BUILD[dimension];
    for (let cx = 0; cx < REGION_CHUNKS; cx++) {
        for (let cz = 0; cz < REGION_CHUNKS; cz++) {
            await paintChunk(png, buffer, cx, cz, minBuildHeight);
        }
    }

    const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
    cacheSet(absolute, { mtimeMs, dataUrl });
    return { dataUrl, dimension, rx, rz };
}

function readChunkBuffer(region: Buffer, cx: number, cz: number): Buffer | null {
    const headerIndex = (cx & 31) + (cz & 31) * 32;
    const location = headerIndex * 4;
    const offset = region.readUIntBE(location, 3) * 4096;
    const sectorCount = region[location + 3];
    if (!offset || !sectorCount) return null;
    const length = region.readUInt32BE(offset);
    const compression = region[offset + 4];
    const payload = region.subarray(offset + 5, offset + 4 + length);
    try {
        if (compression === 1) return gunzipSync(payload);
        if (compression === 2) return inflateSync(payload);
        if (compression === 3) return Buffer.from(payload);
    } catch (err) {
        console.debug("[Service:Map] chunk decompress failed:", String(err));
        return null;
    }
    return null;
}

async function paintChunk(
    png: PNG,
    region: Buffer,
    cx: number,
    cz: number,
    minBuildHeight: number,
): Promise<void> {
    const chunkBuffer = readChunkBuffer(region, cx, cz);
    if (!chunkBuffer) return;
    const root = await parseChunk(chunkBuffer);
    if (!root || root.Status !== "minecraft:full" || !root.sections || !root.Heightmaps) {
        return;
    }
    const heightmap = root.Heightmaps.WORLD_SURFACE ?? root.Heightmaps.MOTION_BLOCKING;
    if (!heightmap) return;
    const bits = heightmapBits(heightmap.length);
    if (bits <= 0) return;
    const heights = unpackPackedLongs(heightmap, bits, 256);
    const sections = new Map<number, Section>(root.sections.map((s) => [s.Y, s]));

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            const stored = heights[lz * CHUNK_SIZE + lx];
            if (stored === undefined) continue;
            const surfaceY = surfaceYFromStored(stored, minBuildHeight);
            const name = surfaceBlockAt(sections, lx, surfaceY, lz, minBuildHeight);
            const [r, g, b] = blockColor(name);
            const px = cx * CHUNK_SIZE + lx;
            const py = cz * CHUNK_SIZE + lz;
            const di = (py * REGION_BLOCKS + px) * 4;
            png.data[di] = r;
            png.data[di + 1] = g;
            png.data[di + 2] = b;
            png.data[di + 3] = 255;
        }
    }
}
