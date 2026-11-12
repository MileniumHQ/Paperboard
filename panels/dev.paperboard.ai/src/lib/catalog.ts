import rawCatalog from "../data/models.json";
import { parseCatalog, splitModelRef, type Catalog, type CatalogModel } from "../core/catalog";
import { estimateFit, type FitEstimate } from "../core/fit";
import { state } from "./state";

export const catalog: Catalog = parseCatalog(rawCatalog);

export function catalogEntry(ref: string): CatalogModel | undefined {
    const { name } = splitModelRef(ref);
    return catalog.models.find((m) => m.name === name);
}

export function makerOf(ref: string): { name: string; icon: string | null } | undefined {
    const entry = catalogEntry(ref);
    return entry ? catalog.makers[entry.maker] : undefined;
}

/** Fit for a download size at the chosen context (capped by the model's own). */
export function fitFor(bytes: number, maxContext?: number, arch?: { layers: number; kvHeads: number; headDim: number }): FitEstimate {
    const ctx = Math.min(state.settings.contextLength, maxContext ?? Number.MAX_SAFE_INTEGER);
    return estimateFit(bytes, ctx, state.hardware, arch);
}
