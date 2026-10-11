import { invoke, invokeIn } from "./ipc";

// system info of whichever computer the transport is scoped to
export interface SystemInfo {
    service: string;
    version: string;
    hostname: string;
    os: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
    ip: string;
    username?: string;
}

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
    /** where the facts came from: "nvidia-smi", "sysfs", "system_profiler", "registry" */
    source: string;
}

export interface GpuReport {
    gpus: GpuInfo[];
    /** probes that failed; non-empty means `gpus` may be incomplete */
    errors: string[];
}

/** One owner's share of a computer: Paperboard itself, or one panel. */
export interface UsageGroup {
    /** "paperboard", or a panel id */
    id: string;
    kind: "paperboard" | "panel";
    memoryBytes: number;
    /** share of the whole computer (every core), 0-100; null until measured */
    cpuPercent: number | null;
}

/** How a computer's CPU and memory are being used, and by whom. */
export interface UsageReport {
    sampledAt: number;
    /** otherBytes: in use by everything that isn't Paperboard or a panel */
    memory: { totalBytes: number; availableBytes: number; otherBytes: number };
    /** null when no CPU interval could be measured */
    cpu: { cores: number; idlePercent: number; otherPercent: number } | null;
    groups: UsageGroup[];
}

export const systemApi = {
    /** primary LAN IPv4 address */
    getLocalIP: (): Promise<string> => invoke<string>("system-get-ip"),

    /** full system info */
    getInfo: (): Promise<SystemInfo> => invoke<SystemInfo>("system-info"),

    /** GPUs of the computer, with memory where the OS reports it */
    getGpus: (): Promise<GpuReport> => invoke<GpuReport>("system-gpus"),

    /**
     * CPU and memory use of a computer, split by panel. Host only: a panel's
     * scoped token is refused.
     */
    getUsage: (computerId?: string): Promise<UsageReport> => invokeIn<UsageReport>(computerId, "system-usage"),

    /** OS notification with fallback */
    notify: (title: string, message: string): Promise<unknown> =>
        invoke<unknown>("system-notify", { title, message }),

    /** screenshot, resolves the path written */
    screenshot: (savePath: string): Promise<string> =>
        invoke<string>("system-screenshot", { savePath }),

    /** output volume (0-100) */
    setVolume: (volume: number): Promise<number> =>
        invoke<number>("system-set-volume", { volume }),

    /** mute/unmute */
    setMuted: (muted: boolean): Promise<boolean> =>
        invoke<boolean>("system-set-muted", { muted }),

    /** short alert sound */
    beep: (): Promise<unknown> => invoke<unknown>("system-beep"),
};

export const system = systemApi;
