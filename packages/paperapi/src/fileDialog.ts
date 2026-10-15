// Save and open dialogs: the shell owns the window, the panel names a file
// in its own storage. A save copies that file to where the user chooses; an
// open copies the chosen file into it. The panel frame asks its shell over
// postMessage, tagged with the generation the shell gave this document.
import { requirePanelId } from "./panelIdentity";
import { currentFrameSession } from "./frameSession";

export interface FileDialogFilter {
    /** the label the dialog shows, e.g. "Backups" */
    name: string;
    /** extensions without the dot, e.g. ["zip"] */
    extensions: string[];
}

export interface SaveDialogOptions {
    /** the file name the dialog starts with; defaults to the source file's name */
    suggestedName?: string;
    filters?: FileDialogFilter[];
}

export interface OpenDialogOptions {
    filters?: FileDialogFilter[];
}

export type SaveDialogResult = { status: "saved"; name: string; bytes: number } | { status: "canceled" };
export type OpenDialogResult = { status: "opened"; name: string; bytes: number } | { status: "canceled" };

export type FileDialogErrorCode =
    | "invalid-request"
    | "busy"
    | "not-found"
    | "too-large"
    | "unreachable"
    | "unsupported"
    | "unavailable"
    | "failed";

export class FileDialogError extends Error {
    constructor(
        readonly code: FileDialogErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "FileDialogError";
    }
}

const REQUEST = "paperboard:file-dialog";
const RESULT = "paperboard:file-dialog-result";

// one dialog per document at a time: the shell refuses a second anyway,
// and a pending request is the only listener this module keeps
let pending: string | null = null;

function ask<T>(kind: "save" | "open", fields: Record<string, unknown>): Promise<T> {
    const session = currentFrameSession();
    if (!session || typeof window === "undefined") {
        return Promise.reject(new FileDialogError("unavailable", "File dialogs need a panel shown in Paperboard"));
    }
    if (session.widget) {
        return Promise.reject(new FileDialogError("unavailable", "A widget cannot open file dialogs; open its panel instead"));
    }
    if (pending) return Promise.reject(new FileDialogError("busy", "A file dialog is already open"));
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
            if (result?.status === "failed") reject(new FileDialogError(result.code ?? "failed", String(result.message ?? "The file dialog failed")));
            else if (result?.status === "canceled" || result?.status === "saved" || result?.status === "opened") resolve(result as T);
            else reject(new FileDialogError("failed", "The shell sent a malformed file dialog result"));
        };
        window.addEventListener("message", receive);
        window.addEventListener("pagehide", finish, { once: true });
        window.parent.postMessage({ type: REQUEST, generation: session.generation, requestId, kind, ...fields }, "*");
    });
}

/**
 * Opens a save dialog for a file in the panel's storage. Resolves with what
 * the user chose; throws FileDialogError when the file could not be saved.
 */
export function saveDialog(sourcePath: string, appId: string, options: SaveDialogOptions = {}): Promise<SaveDialogResult> {
    return ask<SaveDialogResult>("save", {
        panelId: requirePanelId(appId),
        path: sourcePath,
        suggestedName: options.suggestedName,
        filters: options.filters,
    });
}

/**
 * Opens an open dialog and copies the chosen file to targetPath in the
 * panel's storage, replacing what was there only once it fully arrived.
 */
export function openDialog(targetPath: string, appId: string, options: OpenDialogOptions = {}): Promise<OpenDialogResult> {
    return ask<OpenDialogResult>("open", {
        panelId: requirePanelId(appId),
        path: targetPath,
        filters: options.filters,
    });
}
