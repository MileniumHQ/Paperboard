import { invoke } from "./ipc";

// Host system information API
export const systemApi = {
    /** Resolves the primary LAN IPv4 address of the host machine. */
    getLocalIP: (): Promise<string> => invoke<string>("system-get-ip"),
};

export const system = systemApi;
