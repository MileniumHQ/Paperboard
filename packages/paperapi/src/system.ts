import { invoke } from "./ipc";

// System information of whichever computer the transport is scoped to.
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

export const systemApi = {
    /** Resolves the primary LAN IPv4 address of the target computer. */
    getLocalIP: (): Promise<string> => invoke<string>("system-get-ip"),

    /** Full system info of the target computer (same source as the IP). */
    getInfo: (): Promise<SystemInfo> => invoke<SystemInfo>("system-info"),
};

export const system = systemApi;
