import { invoke, on } from "./ipc";
import { newClientId } from "./channels";
import { requirePanelId } from "./panelIdentity";

// every file call names the panel whose storage it touches: an omitted id
// used to fall back to "whoever this document is", which is ambient identity
const owner = (appId: unknown): string => requirePanelId(appId);

export interface FileDownloadProgress {
    downloadId: string;
    stage: "starting" | "downloading" | "verifying" | "completed" | "error";
    percent: number;
    bytesLoaded?: number;
    bytesTotal?: number;
    message?: string;
}

export interface FileDownloadOptions {
    url: string;
    targetPath: string;
    appId: string;
    sha1?: string;
    sha256?: string;
    checksum?: {
        algorithm: "sha1" | "sha256" | "md5" | string;
        value: string;
    };
    onProgress?: (progress: FileDownloadProgress) => void;
}

// panel file storage and downloads
export const fileApi = {
    download: async (opts: FileDownloadOptions): Promise<string> => {
        const appId = owner(opts.appId);

        const downloadId = newClientId("file");

        // hoisted so a rejected invoke can unsubscribe: a download that
        // fails to start must not leave a permanently subscribed listener
        let off: (() => void) | undefined;
        if (opts.onProgress) {
            off = on(`file-progress:${downloadId}`, (event: unknown, data: any) => {
                const payload = data !== undefined ? data : event;
                if (payload) {
                    const progress = payload as FileDownloadProgress;
                    opts.onProgress!(progress);
                    if (progress.stage === "completed" || progress.stage === "error") {
                        off?.();
                    }
                }
            });
        }

        try {
            return await invoke("file-download", {
                url: opts.url,
                targetPath: opts.targetPath,
                appId,
                downloadId,
                sha1: opts.sha1,
                sha256: opts.sha256,
                checksum: opts.checksum,
            });
        } catch (err) {
            off?.();
            throw err;
        }
    },

    getPath: (targetPath: string, appId: string): Promise<string> =>
        invoke("file-get-path", { targetPath, appId: owner(appId) }),

    exists: (targetPath: string, appId: string): Promise<boolean> =>
        invoke("file-exists", { targetPath, appId: owner(appId) }),

    write: (targetPath: string, content: string, appId: string): Promise<string> =>
        invoke("file-write", { targetPath, content, appId: owner(appId) }),

    read: (targetPath: string, appId: string): Promise<string | null> =>
        invoke("file-read", { targetPath, appId: owner(appId) }),

    delete: (targetPath: string, appId: string): Promise<boolean> =>
        invoke("file-delete", { targetPath, appId: owner(appId) }),

    clear: (appId: string): Promise<boolean> =>
        invoke("file-clear", { appId: owner(appId) }),
};

export const files = fileApi;
