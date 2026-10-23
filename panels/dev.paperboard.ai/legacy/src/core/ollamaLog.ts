// Parsers for `ollama serve` output (Go slog text handler). Ollama binds
// the port we ask for; with port 0 the kernel picks one, and this log line
// is the only place the real address appears.

import type { ComputeDevice } from "./types";

/** key=value / key="quoted value" pairs of one slog text line. */
export function parseSlogLine(line: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /([A-Za-z_][\w.]*)=("((?:[^"\\]|\\.)*)"|\S*)/g;
    for (let m = re.exec(line); m; m = re.exec(line)) {
        out[m[1]!] = m[3] !== undefined ? m[3].replace(/\\(.)/g, "$1") : m[2]!;
    }
    return out;
}

export interface ListeningInfo {
    host: string;
    port: number;
    version?: string;
}

/** `msg="Listening on 127.0.0.1:43215 (version 0.34.4)"` */
export function parseListening(line: string): ListeningInfo | null {
    const m = line.match(/Listening on (\[[^\]]+\]|[^\s:]+):(\d{1,5})(?: \(version ([^)]+)\))?/);
    if (!m) return null;
    const port = Number(m[2]);
    if (!(port > 0 && port < 65536)) return null;
    return { host: m[1]!.replace(/^\[|\]$/g, ""), port, ...(m[3] ? { version: m[3] } : {}) };
}

const UNITS: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
};

export function parseHumanBytes(value: string | undefined): number | undefined {
    const m = value?.trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/);
    if (!m) return undefined;
    const unit = UNITS[m[2]!];
    return unit ? Math.round(Number(m[1]) * unit) : undefined;
}

/** `msg="inference compute" library=ROCm description="AMD Radeon RX 7800 XT" total="16.0 GiB" ...` */
export function parseInferenceCompute(line: string): ComputeDevice | null {
    if (!line.includes('msg="inference compute"')) return null;
    const kv = parseSlogLine(line);
    const library = kv.library || "unknown";
    const cpu = library.toLowerCase() === "cpu";
    const name = cpu ? "CPU" : kv.description && kv.description !== "cpu" ? kv.description : kv.name || "GPU";
    return {
        library: cpu ? "CPU" : library,
        name,
        ...(parseHumanBytes(kv.total) ? { totalBytes: parseHumanBytes(kv.total) } : {}),
        ...(parseHumanBytes(kv.available) ? { availableBytes: parseHumanBytes(kv.available) } : {}),
    };
}

/**
 * Splits a byte stream into lines with a hard per-line cap, so a runaway
 * producer cannot grow the buffer without bound.
 */
export class LineSplitter {
    private buffer = "";
    constructor(private readonly maxLine = 1024 * 1024) {}

    push(chunk: string): string[] {
        this.buffer += chunk;
        const parts = this.buffer.split(/\r?\n/);
        this.buffer = parts.pop() ?? "";
        if (this.buffer.length > this.maxLine) {
            throw new Error(`line exceeds ${this.maxLine} characters`);
        }
        return parts;
    }

    /** the unterminated tail, once the stream has ended */
    flush(): string[] {
        const rest = this.buffer;
        this.buffer = "";
        return rest ? [rest] : [];
    }
}

/** Keeps the last `max` lines: the tail shown when Ollama fails. */
export function appendTail(tail: string[], lines: string[], max = 20): string[] {
    const next = [...tail, ...lines.filter((l) => l.trim())];
    return next.length > max ? next.slice(next.length - max) : next;
}
