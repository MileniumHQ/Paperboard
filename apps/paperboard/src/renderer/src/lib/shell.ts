// Privileged shell-only IPC; panels speak PaperCrane directly over WebSocket.
import { panelPath } from "@mileniumhq/paperapi";
import { createBrowserBridge, type ShellIpc } from "./browserBridge";
import type { LaunchOptions } from "../../../shared/launchOptions";
import type { Graphics } from "../../../shared/graphics";
import type { PanelPermission, PanelPermissionEntry, PermissionAnswer, PermissionAsk, ScreenPick, SystemBlock } from "../../../shared/panelPermissions";

export interface ComputerInfo {
    id: string;
    name: string;
    host: string;
    port: number;
    /** the address other machines reach this computer at (local computer only) */
    networkAddress?: string;
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

// Electron windows get the preload bridge; browser mode (`--browser`) has
// no preload and talks to the host over HTTP with the same surface.
let browserBridge: ShellIpc | null = null;

export function isBrowserShell(): boolean {
    return !window.electron?.ipcRenderer;
}

export function shellIpc(): ShellIpc {
    const electron = window.electron?.ipcRenderer;
    if (electron) return electron as unknown as ShellIpc;
    browserBridge ??= createBrowserBridge();
    return browserBridge;
}

const requireIpc = shellIpc;

// Where a panel's documents and assets load from. Electron serves each
// panel from its own panel:// origin; a browser host from a folder of the
// shell's own origin, /_panel/<computerId>/<panelId>/.
export function panelUrl(computerId: string, panelId: string, subpath = ""): string {
    const rest = subpath.replace(/^\.?\//, "");
    if (!isBrowserShell()) return `panel://${computerId}.${panelId}/${rest}`;
    return `${location.origin}${panelPath(computerId, panelId, rest)}`;
}

/** One file of an installed panel's manifest or store listing, as bytes. */
export async function readPanelListingFile(
    computerId: string,
    panelId: string,
    path: string,
): Promise<Uint8Array> {
    const base64 = await requireIpc().invoke<string>("panel-listing-file", {
        computerId,
        panelId,
        path,
    });
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
    /** an unopened folder answers why */
    openPanelFolder: (computerId: string, panelId?: string): Promise<{ opened: boolean; error?: string }> =>
        requireIpc().invoke<{ opened: boolean; error?: string }>("open-panel-folder", {
            computerId,
            panelId,
        }),
    getAppVersion: (): Promise<string> =>
        requireIpc().invoke<string>("app-version"),
    getLaunchOptions: (): Promise<LaunchOptions> =>
        requireIpc().invoke<LaunchOptions>("launch-options"),
    /** whether Paperboard is drawn on a GPU, and again whenever that changes */
    getGraphics: (): Promise<Graphics> => requireIpc().invoke<Graphics>("graphics"),
    onGraphicsChanged: (cb: (graphics: Graphics) => void): (() => void) => {
        const handler = (_event: unknown, data: Graphics) => cb(data);
        requireIpc().on("graphics-changed", handler);
        return () => requireIpc().removeListener?.("graphics-changed", handler);
    },
};
// Main applies side effects of freshly persisted settings (theme, title bars,
// login item); resolves to why Run on startup couldn't be applied, or null
export function notifyAppSettingsChanged(): Promise<string | null> {
    return requireIpc().invoke<string | null>("app-settings-changed");
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

// Panels ask for the microphone, camera or screen; main asks the window the
// panel is in (PanelPermissionPrompt) and keeps the answers per panel.
export const panelPermissionsApi = {
    list: (): Promise<PanelPermissionEntry[]> =>
        requireIpc().invoke<PanelPermissionEntry[]>("panel-permissions-list"),
    set: (panelId: string, permission: PanelPermission, answer: PermissionAnswer): Promise<void> =>
        requireIpc().invoke<void>("panel-permission-set", { panelId, permission, answer }),
    /** a PermissionAnswer for an ask, a source id (or null) for a screen pick */
    answer: (askId: string, answer: string | null): Promise<void> =>
        requireIpc().invoke<void>("panel-permission-answer", { askId, answer }),
    openSystemSettings: (permission: PanelPermission): Promise<void> =>
        requireIpc().invoke<void>("open-system-privacy", permission),
    onAsk: (cb: (ask: PermissionAsk) => void) => listen("panel-permission-ask", cb),
    onScreenPick: (cb: (pick: ScreenPick) => void) => listen("panel-screen-pick", cb),
    onSystemBlock: (cb: (block: SystemBlock) => void) => listen("panel-permission-system", cb),
    onChanged: (cb: () => void) => listen("panel-permissions-changed", cb),
};

function listen<T>(channel: string, cb: (payload: T) => void): () => void {
    const handler = (_event: unknown, payload: T) => cb(payload);
    requireIpc().on(channel, handler);
    return () => requireIpc().removeListener?.(channel, handler);
}
