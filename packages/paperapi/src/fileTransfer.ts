// Exporting and importing files: an export copies a file out of the panel's
// storage to where the user chooses, an import copies a file the user picks
// into it. The shell owns the picker window; the panel names only a path in
// its own storage. The panel frame asks its shell over
// postMessage, tagged with the generation the shell gave this document.
import { requirePanelId } from "./panelIdentity";
import { currentFrameSession } from "./frameSession";

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

const REQUEST = "paperboard:file-transfer";
const RESULT = "paperboard:file-transfer-result";

// one dialog per document at a time: the shell refuses a second anyway,
// and a pending request is the only listener this module keeps
let pending: string | null = null;

function ask<T>(kind: "export" | "import", fields: Record<string, unknown>): Promise<T> {
    const session = currentFrameSession();
    if (!session || typeof window === "undefined") {
        return Promise.reject(new FileTransferError("unavailable", "Exporting and importing files needs a panel shown in Paperboard"));
    }
    if (session.widget) {
        return Promise.reject(new FileTransferError("unavailable", "A widget cannot export or import files; open its panel instead"));
    }
    if (pending) return Promise.reject(new FileTransferError("busy", "An export or import is already running"));
    const requestId = crypto.randomUUID();
    pending = requestId;
    return new Promise<T>((resolve, reject) => {
        const finish = () => {
            pending = null;
            window.removeEventListener("message", receive);
            window.removeEventListener("pagehide", finish);
        };
        const receive = (event: MessageEvent) => {
            const data = event.data;
            if (event.source !== window.parent || data?.type !== RESULT) return;
            if (data.generation !== session.generation || data.requestId !== requestId) return;
            finish();
            const result = data.result;
            if (result?.status === "failed") reject(new FileTransferError(result.code ?? "failed", String(result.message ?? "The file transfer failed")));
            else if (result?.status === "canceled" || result?.status === "exported" || result?.status === "imported") resolve(result as T);
            else reject(new FileTransferError("failed", "The shell sent a malformed file transfer result"));
        };
        window.addEventListener("message", receive);
        window.addEventListener("pagehide", finish, { once: true });
        window.parent.postMessage({ type: REQUEST, generation: session.generation, requestId, kind, ...fields }, "*");
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
