import { PanelManifest } from "../../../../papercrane/types";

export interface ProgressPayload {
    stage: "starting" | "checking" | "downloading" | "verifying" | "extracting" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export type ProgressCallback = (payload: ProgressPayload) => void;

export interface SystemInfo {
    hostname: string;
    os: "windows" | "macos" | "linux" | string;
    osVersion?: string;
    distroId?: string;
    distroName?: string;
    arch: string;
    cpus?: number;
    totalMem?: number;
    freeMem?: number;
    uptime?: number;
}

// The driver abstraction exists for the UPDATER's remote-capable surface:
// probe a computer, install panels/packages, read/write config. Panels do
// NOT render through the driver — panel iframes speak the daemon protocol
// directly (PaperAPI), and streams/shell/files are owned there. Everything
// else was a dead passthrough and is gone (honor or delete).
export interface ComputerDriver {
    getId(): string;
    getSystemInfo(): Promise<SystemInfo>;

    getPackageIndex(): Promise<Record<string, any>>;

    listPanels(): Promise<PanelManifest[]>;
    installPanel(
        panelId: string,
        downloadUrl: string,
        expectedSha256?: string,
    ): Promise<PanelManifest>;

    downloadPackage(
        packageName: string,
        downloadId: string,
        onProgress: ProgressCallback,
        expectedSha256?: string,
    ): Promise<string>;

    updateCrane(
        version: string,
        downloadUrl: string,
        sha256?: string,
    ): Promise<void>;

    getConfig(id: string): Promise<any>;
    setConfig(id: string, data: any): Promise<boolean>;
}
