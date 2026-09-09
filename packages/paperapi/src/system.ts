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

export const systemApi = {
    /** primary LAN IPv4 address */
    getLocalIP: (): Promise<string> => invoke<string>("system-get-ip"),

    /** full system info */
    getInfo: (): Promise<SystemInfo> => invoke<SystemInfo>("system-info"),

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
