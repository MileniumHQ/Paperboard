import { invoke } from "./ipc";

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

export const systemApi = {
    /** primary LAN IPv4 address */
    getLocalIP: (): Promise<string> => invoke<string>("system-get-ip"),

    /** full system info */
    getInfo: (): Promise<SystemInfo> => invoke<SystemInfo>("system-info"),

    /** GPUs of the computer, with memory where the OS reports it */
    getGpus: (): Promise<GpuReport> => invoke<GpuReport>("system-gpus"),

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
