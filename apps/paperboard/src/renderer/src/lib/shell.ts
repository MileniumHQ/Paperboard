// Privileged shell-only IPC; panels speak PaperCrane directly over WebSocket.

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
        error?: string;
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

export interface DiscoveredComputer {
    id: string;
    name: string;
    host: string;
    port: number;
    version?: string;
    os?: string;
}

const ipc = () => window.electron?.ipcRenderer;

function requireIpc() {
    const bridge = ipc();
    if (!bridge) throw new Error("[shell] Electron IPC bridge unavailable");
    return bridge;
}

export const computersApi = {
    list: (): Promise<ComputerListResult> =>
        requireIpc().invoke<ComputerListResult>("computers-list"),

    probe: (host: string, port?: number): Promise<ComputerProbeResult> =>
        requireIpc().invoke<ComputerProbeResult>("computer-probe", {
            host,
            port,
        }),

    pair: (
        host: string,
        port: number | undefined,
        code: string,
        name?: string,
    ): Promise<ComputerInfo> =>
        requireIpc().invoke<ComputerInfo>("computer-pair", {
            host,
            port,
            code: code || "",
            name,
        }),

    update: (
        id: string,
        updates: { name?: string; port?: number },
    ): Promise<boolean> =>
        requireIpc().invoke<boolean>("computer-update", { id, ...updates }),

    remove: (id: string): Promise<boolean> =>
        requireIpc().invoke<boolean>("computer-remove", id),

    switch: (id: string): Promise<boolean> =>
        requireIpc().invoke<boolean>("computer-switch", id),

    onChanged: (
        cb: (data: { computers?: ComputerInfo[]; activeId?: string }) => void,
    ): (() => void) => {
        const handler = (_event: unknown, data: any) => cb(data ?? {});
        requireIpc().on("computers-changed", handler);
        return () =>
            requireIpc().removeListener?.("computers-changed", handler);
    },
};

// Nearby PaperCrane machines found via mDNS/Bonjour browsing in main.
export const discoveryApi = {
    list: (): Promise<DiscoveredComputer[]> =>
        requireIpc().invoke<DiscoveredComputer[]>("discovery-list"),

    onChanged: (cb: (services: DiscoveredComputer[]) => void): (() => void) => {
        const handler = (_event: unknown, data: any) =>
            cb(Array.isArray(data) ? data : []);
        requireIpc().on("discovery-changed", handler);
        return () =>
            requireIpc().removeListener?.("discovery-changed", handler);
    },
};

// Opens the local data dir (or a panel's files dir) in the OS file manager
export const shellApi = {
    openPanelFolder: (computerId: string, panelId?: string): Promise<boolean> =>
        requireIpc().invoke<boolean>("open-panel-folder", {
            computerId,
            panelId,
        }),
    getAppVersion: (): Promise<string> =>
        requireIpc().invoke<string>("app-version"),
};
// Main applies side effects of freshly persisted settings (theme, title bars, login item)
export function notifyAppSettingsChanged(): void {
    requireIpc().send("app-settings-changed");
}

// Forwards renderer errors into the main file logger
export function logToMain(
    level: "info" | "warn" | "error",
    ...args: unknown[]
): void {
    // R12: serialization happens INSIDE the try — a circular payload must
    // degrade to a safe string here, not throw in the caller's context
    // and defeat "logging must never break the caller".
    let message = "";
    try {
        const seen = new WeakSet<object>();
        message = args
            .map((a) =>
                a instanceof Error
                    ? a.stack ?? String(a)
                    : typeof a === "object"
                      ? JSON.stringify(a, (_key, value) => {
                          if (value && typeof value === "object") {
                              if (seen.has(value)) return "[Circular]";
                              seen.add(value);
                          }
                          return value;
                      }, 2)
                      : String(a),
            )
            .join(" ");
        requireIpc().send("renderer-log", level, message);
    } catch (err) {
        // Logging must never break the caller, but the failure itself is logged
        console.warn("[shell.ts] logToMain failed (IPC unavailable):", err);
    }
}
