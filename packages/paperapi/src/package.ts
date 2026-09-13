import { invoke, on } from "./ipc";
import { newClientId } from "./channels";

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

// system tool and runtime packages
export const packageApi = {
    download: async (
        packageName: string,
        onProgress?: (progress: PackageProgress) => void,
    ): Promise<string> => {
        const downloadId = newClientId(packageName);
        // hoisted so a rejected invoke can unsubscribe (see file.ts)
        let off: (() => void) | undefined;
        if (onProgress) {
            off = on(`package-progress:${downloadId}`, (event: any, payload: any) => {
                const data = payload !== undefined ? payload : event;
                if (data) {
                    const progress = data as PackageProgress;
                    onProgress(progress);
                    if (progress.stage === "completed" || progress.stage === "error") {
                        off?.();
                    }
                }
            });
        }
        try {
            return await invoke<string>("package-download", { packageName, downloadId });
        } catch (err) {
            off?.();
            throw err;
        }
    },

    isInstalled: (packageName: string, version?: string): Promise<boolean> =>
        invoke<boolean>("package-is-installed", { packageName, version }),

    getIndex: (): Promise<Record<string, InstalledPackageRecord | string>> =>
        invoke<Record<string, InstalledPackageRecord | string>>("package-get-index"),

    getPath: (packageName: string): Promise<string> =>
        invoke<string>("package-get-path", packageName),
};

export const packages = packageApi;
