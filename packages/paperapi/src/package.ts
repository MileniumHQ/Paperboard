import { invoke, on } from "./ipc";

export interface PackageProgress {
    stage: "checking" | "downloading" | "verifying" | "extracting" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export interface InstalledPackageRecord {
    version?: string;
    installedAt?: string;
    path?: string;
    [key: string]: unknown;
}

// System tool & runtime packages manager (e.g. Java, Python, Node)
export const packageApi = {
    download: async (
        packageName: string,
        onProgress?: (progress: PackageProgress) => void,
    ): Promise<string> => {
        const downloadId = `${packageName}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        if (onProgress) {
            on(`package-progress:${downloadId}`, (event: any, payload: any) => {
                const data = payload !== undefined ? payload : event;
                if (data) onProgress(data);
            });
        }
        return invoke<string>("package-download", { packageName, downloadId });
    },

    isInstalled: (packageName: string, version?: string): Promise<boolean> =>
        invoke<boolean>("package-is-installed", { packageName, version }),

    getIndex: (): Promise<Record<string, InstalledPackageRecord | string>> =>
        invoke<Record<string, InstalledPackageRecord | string>>("package-get-index"),

    getPath: (packageName: string): Promise<string> =>
        invoke<string>("package-get-path", packageName),
};

export const packages = packageApi;
