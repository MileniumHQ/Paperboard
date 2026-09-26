// GPU inventory for system:gpus. Read-only probes with fixed argv and
// timeouts, no shell. A probe that fails is reported in `errors` so callers
// can tell "this machine has no GPU" from "we could not look".
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "./logger";

export type GpuVendor = "nvidia" | "amd" | "intel" | "apple" | "other";

export interface GpuInfo {
    name: string;
    vendor: GpuVendor;
    /** dedicated memory, or system memory when unifiedMemory is true */
    memoryTotalBytes?: number;
    memoryFreeBytes?: number;
    /** the GPU shares system RAM (Apple Silicon) */
    unifiedMemory?: boolean;
    driver?: string;
    /** where the facts came from, e.g. "nvidia-smi", "sysfs" */
    source: string;
}

export interface GpuReport {
    gpus: GpuInfo[];
    /** probes that failed; non-empty means the list may be incomplete */
    errors: string[];
}

export type ExecFn = (command: string, args: string[], timeoutMs: number) => Promise<string>;

export interface GpuProbeDeps {
    platform?: NodeJS.Platform;
    exec?: ExecFn;
    sysfsRoot?: string;
    pciIdsPaths?: string[];
    totalMem?: () => number;
}

const PROBE_TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 1024 * 1024;

const defaultExec: ExecFn = (command, args, timeoutMs) =>
    new Promise((resolve, reject) => {
        execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true }, (err, stdout) => {
            if (err) reject(err);
            else resolve(String(stdout));
        });
    });

const VENDOR_IDS: Record<string, GpuVendor> = {
    "0x10de": "nvidia",
    "0x1002": "amd",
    "0x8086": "intel",
};

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === "ENOENT";

// ─── nvidia-smi (Linux, Windows) ─────────────────────────────────────────────

export function parseNvidiaSmi(csv: string): GpuInfo[] {
    const gpus: GpuInfo[] = [];
    for (const line of csv.split(/\r?\n/)) {
        const cols = line.split(",").map((c) => c.trim());
        if (cols.length < 4 || !cols[0]) continue;
        const total = Number(cols[1]);
        const free = Number(cols[2]);
        gpus.push({
            name: cols[0],
            vendor: "nvidia",
            ...(Number.isFinite(total) ? { memoryTotalBytes: total * 1024 * 1024 } : {}),
            ...(Number.isFinite(free) ? { memoryFreeBytes: free * 1024 * 1024 } : {}),
            ...(cols[3] ? { driver: cols[3] } : {}),
            source: "nvidia-smi",
        });
    }
    return gpus;
}

async function probeNvidiaSmi(exec: ExecFn, errors: string[]): Promise<GpuInfo[] | null> {
    try {
        const out = await exec(
            "nvidia-smi",
            ["--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"],
            PROBE_TIMEOUT_MS,
        );
        return parseNvidiaSmi(out);
    } catch (err) {
        // no nvidia-smi on PATH is the normal non-NVIDIA case, not a failure
        if (!isMissing(err)) errors.push(`nvidia-smi: ${(err as Error)?.message ?? String(err)}`);
        return null;
    }
}

// ─── pci.ids names (Linux) ───────────────────────────────────────────────────

const PCI_IDS_PATHS = ["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids"];

export function lookupPciName(pciIds: string, vendorId: string, deviceId: string): string | null {
    const v = vendorId.replace(/^0x/, "").toLowerCase();
    const d = deviceId.replace(/^0x/, "").toLowerCase();
    const vendorAt = pciIds.search(new RegExp(`^${v}\\s`, "m"));
    if (vendorAt < 0) return null;
    const lines = pciIds.slice(vendorAt).split("\n");
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i]!;
        if (line && !line.startsWith("\t") && !line.startsWith("#")) break; // next vendor
        const m = line.match(/^\t([0-9a-f]{4})\s+(.+)$/);
        if (m && m[1] === d) {
            const full = m[2]!.trim();
            // "Navi 32 [Radeon RX 7700 XT / 7800 XT]" → the marketing name
            const bracket = full.match(/\[([^\]]+)\]\s*$/);
            return bracket ? bracket[1]! : full;
        }
    }
    return null;
}

function readPciIds(paths: string[]): string | null {
    for (const p of paths) {
        try {
            return fs.readFileSync(p, "utf8");
        } catch (err) {
            if (!isMissing(err)) logger.debug(`[gpu] ${p} unreadable:`, err);
        }
    }
    return null;
}

// ─── sysfs (Linux) ───────────────────────────────────────────────────────────

function readSys(file: string): string | null {
    try {
        return fs.readFileSync(file, "utf8").trim();
    } catch (err) {
        if (!isMissing(err)) logger.debug(`[gpu] ${file} unreadable:`, err);
        return null;
    }
}

export function probeSysfs(sysfsRoot: string, pciIdsPaths: string[], errors: string[]): GpuInfo[] {
    const drm = path.join(sysfsRoot, "class", "drm");
    let entries: string[];
    try {
        entries = fs.readdirSync(drm).filter((e) => /^card\d+$/.test(e));
    } catch (err) {
        if (!isMissing(err)) errors.push(`sysfs: ${(err as Error)?.message ?? String(err)}`);
        return [];
    }
    let pciIds: string | null | undefined;
    const gpus: GpuInfo[] = [];
    for (const card of entries.sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))) {
        const dev = path.join(drm, card, "device");
        const vendorId = readSys(path.join(dev, "vendor"));
        const deviceId = readSys(path.join(dev, "device"));
        if (!vendorId || !deviceId) continue;
        const vendor = VENDOR_IDS[vendorId.toLowerCase()] ?? "other";
        if (pciIds === undefined) pciIds = readPciIds(pciIdsPaths);
        const name =
            readSys(path.join(dev, "product_name")) ||
            (pciIds ? lookupPciName(pciIds, vendorId, deviceId) : null) ||
            `GPU ${vendorId.replace(/^0x/, "")}:${deviceId.replace(/^0x/, "")}`;
        const total = Number(readSys(path.join(dev, "mem_info_vram_total")));
        const used = Number(readSys(path.join(dev, "mem_info_vram_used")));
        let driver: string | undefined;
        try {
            driver = path.basename(fs.readlinkSync(path.join(dev, "driver")));
        } catch (err) {
            logger.debug(`[gpu] ${card} driver link unreadable:`, err);
        }
        gpus.push({
            name,
            vendor,
            ...(total > 0 ? { memoryTotalBytes: total } : {}),
            ...(total > 0 && Number.isFinite(used) ? { memoryFreeBytes: Math.max(0, total - used) } : {}),
            ...(driver ? { driver } : {}),
            source: "sysfs",
        });
    }
    return gpus;
}

// ─── system_profiler (macOS) ─────────────────────────────────────────────────

function parseMacMemory(value: unknown): number | undefined {
    if (typeof value !== "string") return undefined;
    const m = value.match(/([\d.]+)\s*(GB|MB)/i);
    if (!m) return undefined;
    return Math.round(Number(m[1]) * (m[2]!.toUpperCase() === "GB" ? 1024 ** 3 : 1024 ** 2));
}

export function parseSystemProfiler(json: string, totalMem: number): GpuInfo[] {
    const data = JSON.parse(json) as { SPDisplaysDataType?: Record<string, unknown>[] };
    const gpus: GpuInfo[] = [];
    for (const entry of data.SPDisplaysDataType ?? []) {
        const name = String(entry.sppci_model ?? entry._name ?? "GPU");
        const vendorRaw = String(entry.spdisplays_vendor ?? entry.sppci_vendor ?? "").toLowerCase();
        const vendor: GpuVendor = vendorRaw.includes("apple")
            ? "apple"
            : vendorRaw.includes("amd") || vendorRaw.includes("ati")
              ? "amd"
              : vendorRaw.includes("nvidia")
                ? "nvidia"
                : vendorRaw.includes("intel")
                  ? "intel"
                  : "other";
        const vram = parseMacMemory(entry.spdisplays_vram ?? entry.spdisplays_vram_shared ?? entry._spdisplays_vram);
        if (vendor === "apple") {
            gpus.push({ name, vendor, memoryTotalBytes: totalMem, unifiedMemory: true, source: "system_profiler" });
        } else {
            gpus.push({ name, vendor, ...(vram ? { memoryTotalBytes: vram } : {}), source: "system_profiler" });
        }
    }
    return gpus;
}

// ─── registry (Windows) ──────────────────────────────────────────────────────

const DISPLAY_CLASS = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

// `reg query <class> /s /v <name>` prints "HKEY_...\\0000" headers followed
// by "    <name>    REG_<TYPE>    <value>" lines
export function parseRegQuery(out: string): Map<string, string> {
    const values = new Map<string, string>();
    let key = "";
    for (const line of out.split(/\r?\n/)) {
        if (/^HKEY_/i.test(line.trim())) {
            key = line.trim();
            continue;
        }
        const m = line.match(/^\s+\S+\s+REG_\w+\s+(.*)$/);
        if (m && key) values.set(key, m[1]!.trim());
    }
    return values;
}

function parseRegNumber(value: string): number | undefined {
    if (/^0x[0-9a-f]+$/i.test(value)) return Number(BigInt(value));
    // REG_BINARY: little-endian hex bytes
    if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 && value.length <= 16) {
        let n = 0n;
        for (let i = value.length - 2; i >= 0; i -= 2) n = (n << 8n) | BigInt(parseInt(value.slice(i, i + 2), 16));
        return Number(n);
    }
    return undefined;
}

export function mergeWindowsRegistry(names: Map<string, string>, memory: Map<string, string>): GpuInfo[] {
    const gpus: GpuInfo[] = [];
    for (const [key, name] of names) {
        const lower = name.toLowerCase();
        // software adapters are not GPUs
        if (lower.includes("basic display") || lower.includes("basic render") || lower.includes("remote display")) continue;
        const vendor: GpuVendor = lower.includes("nvidia")
            ? "nvidia"
            : lower.includes("amd") || lower.includes("radeon")
              ? "amd"
              : lower.includes("intel")
                ? "intel"
                : "other";
        const raw = memory.get(key);
        const total = raw ? parseRegNumber(raw) : undefined;
        gpus.push({ name, vendor, ...(total && total > 0 ? { memoryTotalBytes: total } : {}), source: "registry" });
    }
    return gpus;
}

async function probeWindowsRegistry(exec: ExecFn, errors: string[]): Promise<GpuInfo[]> {
    try {
        const [names, memory] = await Promise.all([
            exec("reg", ["query", DISPLAY_CLASS, "/s", "/v", "DriverDesc"], PROBE_TIMEOUT_MS),
            exec("reg", ["query", DISPLAY_CLASS, "/s", "/v", "HardwareInformation.qwMemorySize"], PROBE_TIMEOUT_MS).catch((err) => {
                // older drivers only publish the 32-bit value
                logger.debug("[gpu] qwMemorySize query failed:", err);
                return exec("reg", ["query", DISPLAY_CLASS, "/s", "/v", "HardwareInformation.MemorySize"], PROBE_TIMEOUT_MS);
            }),
        ]);
        return mergeWindowsRegistry(parseRegQuery(names), parseRegQuery(memory));
    } catch (err) {
        errors.push(`registry: ${(err as Error)?.message ?? String(err)}`);
        return [];
    }
}

// ─── entry point ─────────────────────────────────────────────────────────────

export async function detectGpus(deps: GpuProbeDeps = {}): Promise<GpuReport> {
    const platform = deps.platform ?? process.platform;
    const exec = deps.exec ?? defaultExec;
    const errors: string[] = [];
    let gpus: GpuInfo[] = [];

    if (platform === "darwin") {
        try {
            const out = await exec("system_profiler", ["SPDisplaysDataType", "-json"], PROBE_TIMEOUT_MS);
            gpus = parseSystemProfiler(out, (deps.totalMem ?? os.totalmem)());
        } catch (err) {
            errors.push(`system_profiler: ${(err as Error)?.message ?? String(err)}`);
        }
        return { gpus, errors };
    }

    // nvidia-smi knows free memory and the real name; other vendors come
    // from the OS inventory, minus the NVIDIA cards nvidia-smi already gave
    const nvidia = await probeNvidiaSmi(exec, errors);
    let rest: GpuInfo[] = [];
    if (platform === "linux") {
        rest = probeSysfs(deps.sysfsRoot ?? "/sys", deps.pciIdsPaths ?? PCI_IDS_PATHS, errors);
    } else if (platform === "win32") {
        rest = await probeWindowsRegistry(exec, errors);
    }
    if (nvidia && nvidia.length > 0) rest = rest.filter((g) => g.vendor !== "nvidia");
    gpus = [...(nvidia ?? []), ...rest];
    return { gpus, errors };
}

// one probe in flight, shared by concurrent callers; a short-lived cache
// keeps a chatty panel from spawning a probe per call
const CACHE_MS = 2_000;
let inflight: Promise<GpuReport> | null = null;
let cached: { at: number; report: GpuReport } | null = null;

export function getGpuReport(): Promise<GpuReport> {
    if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.report);
    if (!inflight) {
        inflight = detectGpus()
            .then((report) => {
                cached = { at: Date.now(), report };
                return report;
            })
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
}
