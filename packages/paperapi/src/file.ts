import { invoke, on, getPanelId } from "./ipc";
import { newClientId } from "./channels";

const getHost = () => getPanelId();

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
    appId?: string;
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
    download: async (
        optionsOrUrl: FileDownloadOptions | string,
        targetPathOrProgress?: string | ((progress: FileDownloadProgress) => void),
        maybeProgress?: (progress: FileDownloadProgress) => void,
    ): Promise<string> => {
        const opts: FileDownloadOptions =
            typeof optionsOrUrl === "string"
                ? {
                      url: optionsOrUrl,
                      targetPath: typeof targetPathOrProgress === "string" ? targetPathOrProgress : "",
                      onProgress:
                          typeof targetPathOrProgress === "function"
                              ? targetPathOrProgress
                              : maybeProgress,
                  }
                : optionsOrUrl;

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
                appId: opts.appId || getHost(),
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

    getPath: (targetPath: string, appId?: string): Promise<string> =>
        invoke("file-get-path", { targetPath, appId: appId || getHost() }),

    exists: (targetPath: string, appId?: string): Promise<boolean> =>
        invoke("file-exists", { targetPath, appId: appId || getHost() }),

    write: (targetPath: string, content: string, appId?: string): Promise<string> =>
        invoke("file-write", { targetPath, content, appId: appId || getHost() }),

    read: (targetPath: string, appId?: string): Promise<string | null> =>
        invoke("file-read", { targetPath, appId: appId || getHost() }),

    delete: (targetPath: string, appId?: string): Promise<boolean> =>
        invoke("file-delete", { targetPath, appId: appId || getHost() }),

    clear: (appId?: string): Promise<boolean> =>
        invoke("file-clear", { appId: appId || getHost() }),
};

export const files = fileApi;
