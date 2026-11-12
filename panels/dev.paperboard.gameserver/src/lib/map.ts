import { serverBridge } from "./server";
import { CALLS } from "../service/contract";
import type { MapDimension, RegionCoord } from "../core/map";

export interface MapDimensionRegions {
    dimension: MapDimension;
    regions: RegionCoord[];
    /** the generated chunks' extent in blocks; max is the first block past the last chunk */
    terrain: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface MapRegionsResult {
    levelName: string;
    dimensions: MapDimensionRegions[];
}

export interface RenderedTile {
    /** the tile's image; null when the `since` that was sent is still this tile */
    dataUrl: string | null;
    /** changes when the region file does */
    version: number;
    dimension: MapDimension;
    rx: number;
    rz: number;
}

export async function listMapRegions(): Promise<MapRegionsResult> {
    const result = await serverBridge.call<Partial<MapRegionsResult>>(
        CALLS.listMapRegions,
    );
    // the service and this UI ship together; an unrecognized shape is a
    // failure, not "no terrain" — coercing it to empty hid real errors
    if (!result || !Array.isArray(result.dimensions)) {
        throw new Error("The map service returned an unrecognized region listing");
    }
    return {
        levelName: result.levelName ?? "",
        dimensions: result.dimensions,
    };
}

export async function renderMapTile(
    dimension: MapDimension,
    rx: number,
    rz: number,
    /** the version of this tile already drawn; the same one comes back with no image */
    since?: number,
): Promise<RenderedTile | null> {
    return serverBridge.call<RenderedTile | null>(CALLS.renderMapTile, {
        dimension,
        rx,
        rz,
        since,
    });
}
