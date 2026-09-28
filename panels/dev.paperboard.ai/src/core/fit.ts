// How well a model fits this computer. An estimate from download size,
// context length and memory, not a benchmark: the measured speed shown
// after a model has run is the real number.

import type { HardwareState } from "./types";

const GiB = 1024 ** 3;

// Ollama skips integrated GPUs by default; a firmware carve-out (the
// 512 MiB of a desktop APU) never hosts a model
export const MIN_GPU_BYTES = 2 * GiB;
// runtime, compute graph and scratch buffers on top of weights + KV cache
export const RUNTIME_OVERHEAD_BYTES = 0.6 * GiB;
// keep headroom for the desktop and other programs
const GPU_HEADROOM = 0.92;
const RAM_SHARE = 0.6;
// Metal's default working-set limit is roughly this share of system RAM
const UNIFIED_GPU_SHARE = 0.7;

/** Attention geometry from /api/show model_info, when known. */
export interface ModelArchitecture {
    layers: number;
    kvHeads: number;
    headDim: number;
}

export type FitRating = "gpu" | "partial" | "cpu" | "too-big" | "unknown";

export interface FitEstimate {
    rating: FitRating;
    /** estimated memory to run at the chosen context length */
    needBytes: number;
    kvBytes: number;
    /** memory the GPUs can give the model (0 when none qualifies) */
    gpuBytes: number;
    ramBytes: number;
    /** 0..1 share of the model that lands on the GPU */
    gpuShare: number;
    /** KV cache from the model's real geometry, or from its size */
    exact: boolean;
    contextLength: number;
}

/** Reads layer/head geometry out of Ollama's model_info map. */
export function architectureFromModelInfo(info: Record<string, unknown> | undefined): ModelArchitecture | null {
    if (!info) return null;
    const arch = typeof info["general.architecture"] === "string" ? (info["general.architecture"] as string) : null;
    if (!arch) return null;
    const num = (key: string) => {
        const v = info[`${arch}.${key}`];
        return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
    };
    const layers = num("block_count");
    const heads = num("attention.head_count");
    const kvHeads = num("attention.head_count_kv") ?? heads;
    const embedding = num("embedding_length");
    const headDim = num("attention.key_length") ?? (embedding && heads ? embedding / heads : null);
    if (!layers || !kvHeads || !headDim) return null;
    return { layers, kvHeads, headDim };
}

/** f16 K and V for every layer and token of context. */
export function kvCacheBytes(weightsBytes: number, contextLength: number, arch?: ModelArchitecture | null): { bytes: number; exact: boolean } {
    if (arch) {
        return { bytes: 2 * arch.layers * arch.kvHeads * arch.headDim * 2 * contextLength, exact: true };
    }
    // size-proportional fallback, calibrated on dense GQA models
    // (an 8B at Q4 needs ~128 KiB per token); clamped for MoE and giants
    const perToken = Math.min(384 * 1024, Math.max(8 * 1024, weightsBytes * 2.6e-5));
    return { bytes: perToken * contextLength, exact: false };
}

/** Memory the GPUs can host: same-vendor discrete cards, summed. */
export function gpuBudget(hw: HardwareState): number {
    const unified = hw.gpus.find((g) => g.unifiedMemory && g.memoryTotalBytes);
    if (unified) return Math.floor(unified.memoryTotalBytes! * UNIFIED_GPU_SHARE);
    const usable = hw.gpus.filter((g) => (g.memoryTotalBytes ?? 0) >= MIN_GPU_BYTES);
    if (usable.length === 0) return 0;
    // Ollama splits a model across GPUs of one backend, not across vendors
    const byVendor = new Map<string, number>();
    for (const g of usable) byVendor.set(g.vendor, (byVendor.get(g.vendor) ?? 0) + g.memoryTotalBytes!);
    return Math.floor(Math.max(...byVendor.values()) * GPU_HEADROOM);
}

export function estimateFit(
    weightsBytes: number,
    contextLength: number,
    hw: HardwareState,
    arch?: ModelArchitecture | null,
): FitEstimate {
    // the need includes the whole context window, so a fit is only as good
    // as the context the model will actually be loaded with
    const kv = kvCacheBytes(weightsBytes, contextLength, arch);
    const needBytes = Math.round(weightsBytes + kv.bytes + RUNTIME_OVERHEAD_BYTES);
    const gpuBytes = hw.loaded ? gpuBudget(hw) : 0;
    const ramBytes = hw.ramBytes;
    const base = { needBytes, kvBytes: kv.bytes, gpuBytes, ramBytes, exact: kv.exact, contextLength };

    if (!hw.loaded || ramBytes <= 0) {
        return { ...base, rating: "unknown", gpuShare: 0 };
    }
    const unified = hw.gpus.some((g) => g.unifiedMemory);
    if (gpuBytes > 0 && needBytes <= gpuBytes) {
        return { ...base, rating: "gpu", gpuShare: 1 };
    }
    // unified memory has nothing to spill into: past the GPU share it is too big
    const spill = unified ? 0 : ramBytes * RAM_SHARE;
    if (gpuBytes > 0 && needBytes <= gpuBytes + spill) {
        return { ...base, rating: "partial", gpuShare: gpuBytes / needBytes };
    }
    if (gpuBytes === 0 && needBytes <= ramBytes * RAM_SHARE) {
        // an unreadable GPU inventory is not "no GPU": say we do not know
        if (hw.errors.length > 0) return { ...base, rating: "unknown", gpuShare: 0 };
        return { ...base, rating: "cpu", gpuShare: 0 };
    }
    return { ...base, rating: "too-big", gpuShare: 0 };
}

export const FIT_LABELS: Record<FitRating, { title: string; detail: string }> = {
    gpu: { title: "Runs on your GPU", detail: "Fits entirely in graphics memory. Replies stream quickly." },
    partial: { title: "Partly on your GPU", detail: "Some layers run on the CPU, which slows replies down." },
    cpu: { title: "CPU only", detail: "No GPU can host it. It works, but replies are slow." },
    "too-big": { title: "Too big for this computer", detail: "It needs more memory than this computer has." },
    unknown: { title: "Unknown fit", detail: "This computer's memory could not be read." },
};

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes >= 1000 * GiB) return `${(bytes / (1024 * GiB)).toFixed(1)} TB`;
    if (bytes >= GiB) return `${(bytes / GiB).toFixed(bytes >= 100 * GiB ? 0 : 1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
