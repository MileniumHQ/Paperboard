import { RPC_ROUTES } from "./ipc";
import { fileDownloadParams } from "./transport/params";
import { followProgress } from "./progress";
import { newClientId } from "./channels";
import { requirePanelId } from "./panelIdentity";
import { importFile, importFiles, importFolder, exportFile } from "./fileTransfer";

export { FileTransferError, type FileTransferErrorCode, type FileTypeFilter, type ImportFileOptions, type ImportFileResult, type ImportFilesResult, type ImportFolderResult, type ImportedFile, type ExportFileOptions, type ExportFileResult } from "./fileTransfer";

// every file call names the panel whose storage it touches: a document's own
// identity is ambient, never a claim to a panel's files
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
    /** any other algorithm is refused before the download starts */
    checksum?: {
        algorithm: "sha1" | "sha256" | "sha512";
        value: string;
    };
    onProgress?: (progress: FileDownloadProgress) => void;
}

// panel file storage and downloads
export const fileApi = {
    download: async (opts: FileDownloadOptions): Promise<string> => {
        const appId = owner(opts.appId);

        const downloadId = newClientId("file");

        const off = opts.onProgress ? followProgress(`file-progress:${downloadId}`, opts.onProgress) : undefined;

        try {
            return await RPC_ROUTES["file-download"].call(undefined, fileDownloadParams({ ...opts, appId, downloadId }));
        } catch (err) {
            off?.();
            throw err;
        }
    },

    getPath: (targetPath: string, appId: string): Promise<string> =>
        RPC_ROUTES["file-get-path"].call(undefined, { targetPath, appId: owner(appId) }),

    exists: (targetPath: string, appId: string): Promise<boolean> =>
        RPC_ROUTES["file-exists"].call(undefined, { targetPath, appId: owner(appId) }),

    write: (targetPath: string, content: string, appId: string): Promise<string> =>
        RPC_ROUTES["file-write"].call(undefined, { targetPath, content, appId: owner(appId) }),

    read: (targetPath: string, appId: string): Promise<string | null> =>
        RPC_ROUTES["file-read"].call(undefined, { targetPath, appId: owner(appId) }),

    delete: (targetPath: string, appId: string): Promise<boolean> =>
        RPC_ROUTES["file-delete"].call(undefined, { targetPath, appId: owner(appId) }),

    clear: (appId: string): Promise<boolean> =>
        RPC_ROUTES["file-clear"].call(undefined, { appId: owner(appId) }),

    /** asks the user where to save a copy of sourcePath from the panel's storage */
    exportFile,

    /** asks the user for a file and copies it into targetPath in the panel's storage */
    importFile,

    /** asks the user for one or more files and copies each into the folder targetDir in the panel's storage */
    importFiles,

    /** asks the user for a folder and copies it, with everything in it, into targetDir in the panel's storage */
    importFolder,
};

export const files = fileApi;
