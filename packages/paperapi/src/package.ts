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

// a runtime update that is downloaded and verified but waits for the
// caller's processes still running the installed release
export interface PendingPackageUpdate {
    name: string;
    version: string;
    blockedBy: Array<{ processId: string; owner: string | null }>;
    error?: string;
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

    /**
     * Updates the caller's own processes hold back. Stop those processes and
     * the daemon installs the update; starting one again picks it up.
     */
    pendingUpdates: (): Promise<PendingPackageUpdate[]> =>
        invoke<PendingPackageUpdate[]>("package-pending"),
};

export const packages = packageApi;
