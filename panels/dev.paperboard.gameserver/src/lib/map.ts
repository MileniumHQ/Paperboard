import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import type { MapDimension, RegionCoord } from "../core/map";

export interface MapDimensionRegions {
    dimension: MapDimension;
    regions: RegionCoord[];
}

export interface MapRegionsResult {
    levelName: string;
    dimensions: MapDimensionRegions[];
}

export interface RenderedTile {
    dataUrl: string;
    dimension: MapDimension;
    rx: number;
    rz: number;
}

export async function listMapRegions(): Promise<MapRegionsResult> {
    const result = await serverBridge.call<Partial<MapRegionsResult>>(
        ACTION_IDS.listMapRegions,
    );
    // tolerate an older service that returned a single `regions` array:
    // never let a shape mismatch crash the renderer
    return {
        levelName: result?.levelName ?? "",
        dimensions: Array.isArray(result?.dimensions) ? result.dimensions : [],
    };
}

export async function renderMapTile(
    dimension: MapDimension,
    rx: number,
    rz: number,
): Promise<RenderedTile | null> {
    return serverBridge.call<RenderedTile | null>(ACTION_IDS.renderMapTile, {
        dimension,
        rx,
        rz,
    });
}
