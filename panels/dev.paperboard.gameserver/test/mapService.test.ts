// Map service path (bun test): a real region file is built with
// prismarine-nbt and read back through service/map.ts, proving the whole
// chain (region header → zlib chunk → NBT → palette names → PNG pixels)
// for both palette formats Minecraft has shipped. The 26.x string palette
// is the one that used to paint every chunk as air (an all-black map).
import { describe, it, expect, mock, beforeEach } from "bun:test";
import * as fs from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import nbt from "prismarine-nbt";
import { PNG } from "pngjs";

let disk = new Set<string>();
let serverProperties = "level-name=world\n";
let listExitCode = 0;
let regionFile = "";
const tempDirs: string[] = [];

const fileApiFake = {
    read: async (path: string) => {
        if (path === "server.properties") return serverProperties;
        return null;
    },
    write: async (path: string, content: string) => {
        disk.add(path);
        if (path === "server.properties") serverProperties = content;
        return `/srv/mc/${path}`;
    },
    exists: async (path: string) => disk.has(path),
    getPath: async () => regionFile,
};

mock.module("@paperboard-dev/paperapi", () => ({
    config: {
        get: async () => null,
        set: async () => true,
    },
    files: fileApiFake,
    fileApi: fileApiFake,
    system: { getInfo: async () => ({ os: "linux" }) },
    processApi: {
        run: async (opts: { onStdout?: (chunk: string) => void }) => {
            opts.onStdout?.("r.0.0.mca\n");
            return { exitCode: listExitCode };
        },
    },
}));

const { renderMapTile, listMapRegions } = await import("../src/service/map");

const ctx = {
    state: { serverStatus: "offline", serverSoftware: "paper", serverVersion: "26.1" },
} as any;

function pack9Bit(values: number[]): [number, number][] {
    const perLong = 7;
    const pairs: [number, number][] = [];
    for (let i = 0; i < values.length; i += perLong) {
        let word = 0n;
        for (let k = 0; k < perLong && i + k < values.length; k++) {
            word |= BigInt(values[i + k]) << BigInt(k * 9);
        }
        pairs.push([
            Number((word >> 32n) & 0xffffffffn) | 0,
            Number(word & 0xffffffffn) | 0,
        ]);
    }
    return pairs;
}

function chunkNbt(palette: nbt.Tag, heightmapStoreY: number): Buffer {
    const heightmap = pack9Bit(new Array(256).fill(heightmapStoreY));
    const root = nbt.comp({
        DataVersion: nbt.int(5023),
        xPos: nbt.int(0),
        zPos: nbt.int(0),
        yPos: nbt.int(-4),
        Status: nbt.string("minecraft:full"),
        // prismarine-nbt's writer wants list elements as an array of field
        // objects (nbt.comp([{...}])), not a field map
        sections: nbt.list(
            nbt.comp([
                {
                    Y: nbt.byte(4),
                    block_states: nbt.comp({ palette }),
                },
            ]),
        ),
        Heightmaps: nbt.comp({
            WORLD_SURFACE: nbt.longArray(heightmap),
            MOTION_BLOCKING: nbt.longArray(heightmap),
        }),
    });
    return nbt.writeUncompressed(root);
}

function buildRegion(
    chunk: Buffer,
    compression: number,
): string {
    const payload =
        compression === 2 ? deflateSync(chunk) : Buffer.from(chunk);
    const sectorCount = Math.ceil((payload.length + 5) / 4096);
    const region = Buffer.alloc(8192 + sectorCount * 4096);
    region.writeUInt32BE(payload.length + 1, 8192);
    region[8196] = compression;
    payload.copy(region, 8197);
    region.writeUIntBE(2, 0, 3);
    region[3] = sectorCount;
    const dir = mkdtempSync(join(tmpdir(), "paperboard-map-"));
    tempDirs.push(dir);
    const file = join(dir, "r.0.0.mca");
    fs.writeFileSync(file, region);
    return file;
}

function pngPixels(dataUrl: string): PNG {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    return PNG.sync.read(Buffer.from(base64, "base64"));
}

beforeEach(() => {
    disk = new Set(["server.properties", "world/region", "world/region/r.0.0.mca"]);
    serverProperties = "level-name=world\n";
    listExitCode = 0;
    regionFile = "";
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe("renderMapTile palettes", () => {
    it("paints a 26.x string palette instead of treating every block as air", async () => {
        // surface y=72 with min-build -64 stores as 137
        regionFile = buildRegion(
            chunkNbt(nbt.list({ type: "string", value: ["minecraft:grass_block"] }), 137),
            2,
        );
        const tile = await renderMapTile(ctx, "overworld", 0, 0);
        expect(tile?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
        const png = pngPixels(tile!.dataUrl);
        const pixel = Array.from(png.data.subarray(0, 4));
        expect(pixel).toEqual([121, 192, 90, 255]);
    });

    it("paints the property-less empty-key compound palette", async () => {
        regionFile = buildRegion(
            chunkNbt(
                nbt.list(
                    nbt.comp([{ "": nbt.string("minecraft:sand") }]),
                ),
                137,
            ),
            2,
        );
        const tile = await renderMapTile(ctx, "overworld", 0, 0);
        const png = pngPixels(tile!.dataUrl);
        expect(Array.from(png.data.subarray(0, 4))).toEqual([219, 211, 160, 255]);
    });

    it("refuses a tile whose chunks use an unsupported compression", async () => {
        regionFile = buildRegion(
            chunkNbt(nbt.list({ type: "string", value: ["minecraft:stone"] }), 137),
            4,
        );
        await expect(renderMapTile(ctx, "overworld", 0, 0)).rejects.toThrow(
            /unsupported chunk compression \(type 4\)/,
        );
    });
});

describe("listMapRegions failures", () => {
    it("reports a directory listing failure instead of no terrain", async () => {
        listExitCode = 2;
        await expect(listMapRegions(ctx)).rejects.toThrow(/Could not list/);
    });
});
