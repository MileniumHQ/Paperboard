import { invoke, on } from "./ipc";

export interface ComputerInfo {
    id: string;
    name: string;
    host: string;
    port: number;
    os?: string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch?: string;
    isLocal?: boolean;
    status: {
        connected: boolean;
        isRemote: boolean;
        host: string;
        port: number;
    };
}

export interface ComputerListResult {
    computers: ComputerInfo[];
    activeId: string;
}

export interface ComputerProbeResult {
    reachable: boolean;
    hostname?: string;
    error?: string;
}

// Multi-computer pairing and active target management API
export const computersApi = {
    list: (): Promise<ComputerListResult> =>
        invoke<ComputerListResult>("computers-list"),

    getActive: async (): Promise<ComputerInfo | undefined> => {
        const res = await invoke<ComputerListResult>("computers-list");
        return res?.computers?.find((c) => c.id === res.activeId) || res?.computers?.[0];
    },

    probe: (host: string, port?: number): Promise<ComputerProbeResult> =>
        invoke<ComputerProbeResult>("computer-probe", { host, port }),

    pair: (host: string, port?: number, code?: string, name?: string): Promise<ComputerInfo> =>
        invoke<ComputerInfo>("computer-pair", { host, port, code: code || "", name }),

    switch: (id: string): Promise<boolean> =>
        invoke<boolean>("computer-switch", id),

    update: (id: string, updates: { name?: string; port?: number }): Promise<boolean> =>
        invoke<boolean>("computer-update", { id, ...updates }),

    remove: (id: string): Promise<boolean> =>
        invoke<boolean>("computer-remove", id),

    onChanged: (callback: (data: ComputerListResult) => void): (() => void) | void => {
        return on("computers-changed", (event: unknown, data: any) => {
            const payload = data !== undefined ? data : event;
            if (payload) callback(payload as ComputerListResult);
        });
    },
};

export const computers = computersApi;
