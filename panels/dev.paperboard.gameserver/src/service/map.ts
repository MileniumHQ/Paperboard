import * as fs from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { PNG } from "pngjs";
import { files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { tryListDirectory } from "../lib/filesystem";
import { resolveVersionProfile, worldPathsFor, type VersionProfile } from "../lib/versionProfile";
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
// The map is only offered from 1.18 (supports("mapRendering")), so the
// overworld floor is -64 even when the server version is not yet known.
const DIMENSION_MIN_BUILD: Record<MapDimension, number> = {
    overworld: -64,
    the_nether: 0,
    the_end: 0,
};

// a region file is a few MB in practice; cap before reading it and cap each
// chunk's decompressed size so a crafted .mca cannot exhaust the daemon
const MAX_REGION_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
// one dimension holding more than this many generated regions (16M chunks)
// is beyond a dashboard map; refuse loudly instead of building an unbounded
// availability list and an unbounded request fan-out
const MAX_REGIONS_PER_DIMENSION = 8192;

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
        palette?: unknown[];
        data?: [number, number][];
    };
}

interface ChunkNbt {
    /** pre-26.4 spelling; 26.4 renames it to `status` */
    Status?: string;
    status?: string;
    sections?: Section[];
    Heightmaps?: Record<string, [number, number][]>;
}

// Where each dimension's region directory lives. worldPathsFor owns the
// layout (vanilla-split, bukkit-split, dimensions/), and the world layouts a
// server may have migrated through are kept as fallbacks so an upgraded
// server does not lose its map.
function regionDirCandidates(
    profile: VersionProfile,
    levelName: string,
    dimension: MapDimension,
): string[] {
    const paths = worldPathsFor(profile, levelName);
    const layout =
        dimension === "overworld"
            ? paths.overworld
            : dimension === "the_nether"
              ? paths.nether
              : paths.end;
    const modern = `${levelName}/dimensions/minecraft/${dimension}`;
    const legacy =
        dimension === "overworld"
            ? levelName
            : dimension === "the_nether"
              ? `${levelName}/DIM-1`
              : `${levelName}/DIM1`;
    const split =
        dimension === "overworld"
            ? levelName
            : dimension === "the_nether"
              ? `${levelName}_nether`
              : `${levelName}_the_end`;
    const dirs = new Set([layout, modern, legacy, split]);
    return [...dirs].map((dir) => `${dir}/region`);
}

async function resolveRegionDir(
    profile: VersionProfile,
    levelName: string,
    dimension: MapDimension,
): Promise<string | null> {
    for (const candidate of regionDirCandidates(profile, levelName, dimension)) {
        try {
            if (await fileApi.exists(candidate, PANEL_ID)) return candidate;
        } catch (err) {
            console.debug(`[Service:Map] region dir probe failed for "${candidate}":`, String(err));
        }
    }
    return null;
}

const DIMENSION_ORDER = MAP_DIMENSIONS;

function profileOf(ctx: ServiceContext<GameServerState>): VersionProfile {
    return resolveVersionProfile(ctx.state.serverSoftware, ctx.state.serverVersion);
}

export async function listMapRegions(
    ctx: ServiceContext<GameServerState>,
): Promise<MapRegionsResult> {
    const levelName = await resolveLevelName();
    const profile = profileOf(ctx);
    const dimensions: MapDimensionRegions[] = [];
    for (const dimension of DIMENSION_ORDER) {
        const dir = await resolveRegionDir(profile, levelName, dimension);
        if (!dir) continue;
        // a listing failure is not an empty directory: an error here would
        // otherwise render as "No generated terrain to map yet"
        const listing = await tryListDirectory(dir);
        if (listing.error) {
            throw new Error(listing.error);
        }
        const regions: RegionCoord[] = [];
        for (const entry of listing.entries) {
            const coord = parseRegionFileName(entry);
            if (coord) regions.push(coord);
        }
        if (regions.length > MAX_REGIONS_PER_DIMENSION) {
            throw new Error(
                `Too many regions to map in ${dimension} (${regions.length}); the map is limited to ${MAX_REGIONS_PER_DIMENSION}`,
            );
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
        return paletteEntryName(palette[0]);
    }
    const bits = Math.max(4, Math.ceil(Math.log2(palette.length)));
    const perLong = Math.floor(64 / bits);
    const index = sectionLayerIndex(y) * 256 + z * CHUNK_SIZE + x;
    const value = Number(
        (longPairToBigInt(section.block_states.data[Math.floor(index / perLong)] ?? [0, 0]) >>
            BigInt((index % perLong) * bits)) &
            ((1n << BigInt(bits)) - 1n),
    );
    return paletteEntryName(palette[value]);
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

// prismarine-nbt long arrays are [high, low] pairs; longPairToBigInt in
// core/map.ts owns the conversion (and its test)
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
    ctx: ServiceContext<GameServerState>,
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
    const profile = profileOf(ctx);
    const dir = await resolveRegionDir(profile, levelName, dimension);
    if (!dir) throw new Error(`No region directory for dimension ${dimension}`);

    const relative = `${dir}/${regionFileName({ x: rx, z: rz })}`;
    if (!(await fileApi.exists(relative, PANEL_ID))) return null;
    const absolute = await fileApi.getPath(relative, PANEL_ID);
    const mtimeMs = fs.statSync(absolute).mtimeMs;
    const size = fs.statSync(absolute).size;
    if (size > MAX_REGION_BYTES) {
        throw new Error(
            `Region file too large to map (${Math.round(size / 1024 / 1024)} MB)`,
        );
    }

    const cached = tileCache.get(absolute);
    if (cached && cached.mtimeMs === mtimeMs) {
        return { dataUrl: cached.dataUrl, dimension, rx, rz };
    }

    const buffer = fs.readFileSync(absolute);
    const png = new PNG({ width: REGION_BLOCKS, height: REGION_BLOCKS });
    const minY = DIMENSION_MIN_BUILD[dimension];
    let paintedChunks = 0;
    const unsupportedCompression = new Set<number>();
    for (let cx = 0; cx < REGION_CHUNKS; cx++) {
        for (let cz = 0; cz < REGION_CHUNKS; cz++) {
            const chunk = readChunkBuffer(buffer, cx, cz);
            if (!chunk) continue;
            if (chunk.unsupported !== undefined) {
                unsupportedCompression.add(chunk.unsupported);
                continue;
            }
            if (await paintChunk(png, chunk.buffer, cx, cz, minY)) {
                paintedChunks++;
            }
        }
    }
    // a tile where every chunk was skipped because the compression is not
    // understood is a failure, not empty terrain: say so instead of serving
    // a transparent tile that reads as "nothing generated here"
    if (paintedChunks === 0 && unsupportedCompression.size > 0) {
        throw new Error(
            `Region ${regionFileName({ x: rx, z: rz })} uses unsupported chunk compression (type ${[...unsupportedCompression].join(", ")})`,
        );
    }

    const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
    cacheSet(absolute, { mtimeMs, dataUrl });
    return { dataUrl, dimension, rx, rz };
}

interface ChunkBuffer {
    buffer: Buffer;
    /** compression type the reader does not implement (e.g. LZ4 = 4) */
    unsupported?: number;
}

function readChunkBuffer(region: Buffer, cx: number, cz: number): ChunkBuffer | null {
    const headerIndex = (cx & 31) + (cz & 31) * 32;
    const location = headerIndex * 4;
    const offset = region.readUIntBE(location, 3) * 4096;
    const sectorCount = region[location + 3];
    if (!offset || !sectorCount) return null;
    const length = region.readUInt32BE(offset);
    const compression = region[offset + 4];
    const payload = region.subarray(offset + 5, offset + 4 + length);
    try {
        if (compression === 1)
            return {
                buffer: gunzipSync(payload, { maxOutputLength: MAX_CHUNK_BYTES }),
            };
        if (compression === 2)
            return {
                buffer: inflateSync(payload, { maxOutputLength: MAX_CHUNK_BYTES }),
            };
        if (compression === 3) return { buffer: Buffer.from(payload) };
    } catch (err) {
        console.debug("[Service:Map] chunk decompress failed:", String(err));
        return null;
    }
    // 4 = LZ4 (server option region-file-compression=lz4) and 127+ are
    // custom; the tile reports the type instead of silently skipping
    return { buffer: Buffer.alloc(0), unsupported: compression };
}

async function paintChunk(
    png: PNG,
    chunkBuffer: Buffer,
    cx: number,
    cz: number,
    minBuildHeight: number,
): Promise<boolean> {
    const root = await parseChunk(chunkBuffer);
    if (!root || !root.sections || !root.Heightmaps) return false;
    // `Status` was renamed to `status` in 26.4; accept both spellings
    const status = root.Status ?? root.status;
    if (status !== undefined && status !== "minecraft:full") return false;
    const heightmap = root.Heightmaps.WORLD_SURFACE ?? root.Heightmaps.MOTION_BLOCKING;
    if (!heightmap) return false;
    const bits = heightmapBits(heightmap.length);
    if (bits <= 0) return false;
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
    return true;
}
