/** Peaks computed per clip; the player resamples them to however many bars fit. */
export const WAVEFORM_RESOLUTION = 2048;

/** Compressed bytes fetched for decoding. Decoded PCM is roughly 10x larger. */
export const DEFAULT_WAVEFORM_MAX_BYTES = 16 * 1024 * 1024;

const MAX_CONCURRENT_DECODES = 2;

let active = 0;
const waiting: Array<() => void> = [];

function acquire(signal: AbortSignal): Promise<void> {
    if (active < MAX_CONCURRENT_DECODES) {
        active++;
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const start = () => {
            signal.removeEventListener("abort", onAbort);
            active++;
            resolve();
        };
        const onAbort = () => {
            const i = waiting.indexOf(start);
            if (i >= 0) waiting.splice(i, 1);
            reject(signal.reason);
        };
        waiting.push(start);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

function release() {
    active--;
    waiting.shift()?.();
}

async function fetchCapped(
    src: string,
    signal: AbortSignal,
    maxBytes: number,
): Promise<ArrayBuffer> {
    const res = await fetch(src, { signal });
    if (!res.ok) throw new Error(`Waveform fetch failed: HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel();
        throw new Error(`Waveform source is ${declared} bytes, over the ${maxBytes} byte cap`);
    }
    if (!res.body) throw new Error("Waveform fetch returned no body");

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`Waveform source exceeds the ${maxBytes} byte cap`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

/** Peak absolute amplitude per bucket across all channels, normalized so the loudest bucket is 1. */
export function computePeaks(
    channels: readonly Float32Array[],
    resolution: number = WAVEFORM_RESOLUTION,
): number[] {
    const length = channels[0]?.length ?? 0;
    if (length === 0) return [];
    const buckets = Math.min(resolution, length);
    const peaks = new Array<number>(buckets).fill(0);
    for (const data of channels) {
        for (let b = 0; b < buckets; b++) {
            const start = Math.floor((b * length) / buckets);
            const end = Math.floor(((b + 1) * length) / buckets);
            let peak = peaks[b];
            for (let i = start; i < end; i++) {
                const v = Math.abs(data[i]);
                if (v > peak) peak = v;
            }
            peaks[b] = peak;
        }
    }
    const max = Math.max(...peaks);
    return max > 0 ? peaks.map((p) => p / max) : peaks;
}

/**
 * Fetches and decodes `src` to compute its waveform. Rejects on HTTP errors,
 * sources over `maxBytes`, missing CORS headers, undecodable audio, and abort.
 */
export async function loadWaveform(
    src: string,
    signal: AbortSignal,
    maxBytes: number = DEFAULT_WAVEFORM_MAX_BYTES,
): Promise<number[]> {
    await acquire(signal);
    try {
        const bytes = await fetchCapped(src, signal, maxBytes);
        signal.throwIfAborted();
        if (typeof OfflineAudioContext === "undefined") {
            throw new Error("Web Audio is unavailable");
        }
        // an offline context decodes without opening an output device
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const buffer = await ctx.decodeAudioData(bytes);
        signal.throwIfAborted();
        const channels: Float32Array[] = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            channels.push(buffer.getChannelData(c));
        }
        return computePeaks(channels);
    } finally {
        release();
    }
}
