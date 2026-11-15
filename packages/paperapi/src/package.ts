import { RPC_ROUTES } from "./ipc";
import { followProgress } from "./progress";
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
    /** what runs from the current release; holds: it is important or long running, and the update waits for it (left out by a Paperboard Server before 0.4) */
    blockedBy: Array<{ processId: string; owner: string | null; holds?: boolean }>;
    error?: string;
}

// system tool and runtime packages
export const packageApi = {
    download: async (
        packageName: string,
        onProgress?: (progress: PackageProgress) => void,
    ): Promise<string> => {
        const downloadId = newClientId(packageName);
        const off = onProgress ? followProgress(`package-progress:${downloadId}`, onProgress) : undefined;
        try {
            return await RPC_ROUTES["package-download"].call(undefined, { packageName, downloadId });
        } catch (err) {
            off?.();
            throw err;
        }
    },

    isInstalled: (packageName: string, version?: string): Promise<boolean> =>
        RPC_ROUTES["package-is-installed"].call(undefined, { packageName, version }),

    getIndex: (): Promise<Record<string, InstalledPackageRecord | string>> =>
        RPC_ROUTES["package-get-index"].call(undefined, {}),

    getPath: (packageName: string): Promise<string> =>
        RPC_ROUTES["package-get-path"].call(undefined, { packageName }),

    /**
     * Updates the caller's own processes hold back. Stop those processes and
     * the daemon installs the update; starting one again picks it up.
     */
    pendingUpdates: (): Promise<PendingPackageUpdate[]> =>
        RPC_ROUTES["package-pending"].call(undefined, {}),
};

export const packages = packageApi;
