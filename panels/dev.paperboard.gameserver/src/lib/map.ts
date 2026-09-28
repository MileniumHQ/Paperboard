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
): Promise<RenderedTile | null> {
    return serverBridge.call<RenderedTile | null>(ACTION_IDS.renderMapTile, {
        dimension,
        rx,
        rz,
    });
}
