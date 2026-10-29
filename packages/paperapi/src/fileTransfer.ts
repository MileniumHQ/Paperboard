// Exporting and importing files: an export copies a file out of the panel's
// storage to where the user chooses, an import copies a file the user picks
// into it. The shell owns the picker window; the panel names only a path in
// its own storage. The panel frame asks its shell through requestShell.
import { requirePanelId } from "./panelIdentity";
import { requestShell } from "./shellRequest";

export interface FileTypeFilter {
    /** the label the dialog shows, e.g. "Backups" */
    name: string;
    /** extensions without the dot, e.g. ["zip"] */
    extensions: string[];
}

export interface ExportFileOptions {
    /** the file name the dialog starts with; defaults to the source file's name */
    suggestedName?: string;
    filters?: FileTypeFilter[];
}

export interface ImportFileOptions {
    filters?: FileTypeFilter[];
}

export interface ImportedFile {
    /** the file's name, or its path below the chosen folder */
    name: string;
    bytes: number;
}

export type ImportFilesResult =
    | { status: "imported"; files: ImportedFile[]; bytes: number }
    | { status: "canceled" };

export type ImportFolderResult =
    | { status: "imported"; /** the folder's name */ name: string; files: ImportedFile[]; bytes: number }
    | { status: "canceled" };

export type ExportFileResult = { status: "exported"; name: string; bytes: number } | { status: "canceled" };
export type ImportFileResult = { status: "imported"; name: string; bytes: number } | { status: "canceled" };

export type FileTransferErrorCode =
    | "invalid-request"
    | "busy"
    | "not-found"
    | "too-large"
    | "unreachable"
    | "unsupported"
    | "unavailable"
    | "failed";

export class FileTransferError extends Error {
    constructor(
        readonly code: FileTransferErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "FileTransferError";
    }
}

function ask<T>(kind: "export" | "import", fields: Record<string, unknown>): Promise<T> {
    const selection = fields.selection;
    return requestShell<T>({
        type: "paperboard:file-transfer",
        fields: { kind, ...fields },
        unavailable: () => new FileTransferError("unavailable", "Exporting and importing files needs a panel shown in Paperboard"),
        widget: () => new FileTransferError("unavailable", "A widget cannot export or import files; open its panel instead"),
        busy: () => new FileTransferError("busy", "An export or import is already running"),
        parse: (result: any) => {
            if (result?.status === "failed") return new FileTransferError(result.code ?? "failed", String(result.message ?? "The file transfer failed"));
            if (result?.status === "imported" && selection !== undefined && !Array.isArray(result.files)) {
                return new FileTransferError("failed", "The shell sent a malformed file transfer result");
            }
            if (result?.status === "canceled" || result?.status === "exported" || result?.status === "imported") return result as T;
            return new FileTransferError("failed", "The shell sent a malformed file transfer result");
        },
    });
}

/**
 * Asks the user where to save a copy of a file from the panel's storage.
 * Resolves with what the user chose; throws FileTransferError when the
 * copy failed.
 */
export function exportFile(sourcePath: string, appId: string, options: ExportFileOptions = {}): Promise<ExportFileResult> {
    return ask<ExportFileResult>("export", {
        panelId: requirePanelId(appId),
        path: sourcePath,
        suggestedName: options.suggestedName,
        filters: options.filters,
    });
}

/**
 * Asks the user for a file and copies it to targetPath in the panel's
 * storage, replacing what was there only once it fully arrived.
 */
export function importFile(targetPath: string, appId: string, options: ImportFileOptions = {}): Promise<ImportFileResult> {
    return ask<ImportFileResult>("import", {
        panelId: requirePanelId(appId),
        path: targetPath,
        filters: options.filters,
    });
}

/**
 * Asks the user for one or more files and copies each into the folder
 * targetDir in the panel's storage under its own name, replacing a file of
 * the same name only once the new one fully arrived. Files already copied
 * stay if a later one fails.
 */
export function importFiles(targetDir: string, appId: string, options: ImportFileOptions = {}): Promise<ImportFilesResult> {
    return ask<ImportFilesResult>("import", {
        panelId: requirePanelId(appId),
        path: targetDir,
        selection: "files",
        filters: options.filters,
    });
}

/**
 * Asks the user for a folder and copies everything in it into
 * targetDir/<folder name> in the panel's storage. A link, or a folder over
 * the file or size limit, is refused before anything is copied.
 */
export function importFolder(targetDir: string, appId: string): Promise<ImportFolderResult> {
    return ask<ImportFolderResult>("import", {
        panelId: requirePanelId(appId),
        path: targetDir,
        selection: "folder",
    });
}
