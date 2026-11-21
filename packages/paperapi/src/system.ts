import { RPC_ROUTES } from "./ipc";

/** One named layer of a computer's identity. */
export interface IdentityPart {
    /** stable lowercase id, e.g. "omarchy", "chromeos", "claude-duet" */
    id: string;
    name: string;
    version?: string;
}

// system info of whichever computer the transport is scoped to
export interface SystemInfo {
    service: string;
    version: string;
    hostname: string;
    os: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    /** what is built on the OS: Omarchy on Arch, Proxmox VE on Debian */
    flavor?: IdentityPart;
    /** what the OS runs in: ChromeOS (Crostini), WSL, a container, a cloud VM */
    machine?: IdentityPart;
    /** the motherboard, on a computer that is not a virtual machine */
    board?: string;
    /** an autonomous agent operating this computer: Claude Duet, Grok Bot */
    operator?: IdentityPart;
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
    // Absent from servers older than these figures; null when the computer
    // can't report them. The two are different things to show.
    /** the drive holding Paperboard's data */
    disk?: { totalBytes: number; freeBytes: number } | null;
    /** traffic over the network adapters, bytes per second */
    network?: { receivePerSecond: number; sendPerSecond: number } | null;
    /** how long the computer has been running, in seconds */
    uptimeSeconds?: number;
}

export const systemApi = {
    /** primary LAN IPv4 address */
    getLocalIP: (): Promise<string> => RPC_ROUTES["system-get-ip"].call(undefined, {}),

    /** full system info */
    getInfo: (): Promise<SystemInfo> => RPC_ROUTES["system-info"].call(undefined, {}),

    /** GPUs of the computer, with memory where the OS reports it */
    getGpus: (): Promise<GpuReport> => RPC_ROUTES["system-gpus"].call(undefined, {}),

    /**
     * CPU and memory use of a computer, split by panel, with its disk,
     * network and uptime. Host only: a panel's
     * scoped token is refused.
     */
    getUsage: (computerId?: string): Promise<UsageReport> => RPC_ROUTES["system-usage"].call(computerId, {}),
};

export const system = systemApi;
