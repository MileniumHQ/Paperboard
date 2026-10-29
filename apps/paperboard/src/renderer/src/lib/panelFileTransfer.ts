// A panel frame asks for a save or open dialog with
// { type: "paperboard:file-transfer", generation, requestId, kind, panelId, path, ... }.
// The shell answers on the same frame with "paperboard:file-transfer-result".
// Identity comes from the frame the message arrived on; the panelId the
// panel names must agree with it. The request's fields are checked once,
// by the host that runs the dialog (src/shared/fileTransfer.ts).
import {
    isImportableName,
    PANEL_IMPORT_MAX_BYTES,
    PANEL_IMPORT_MAX_FILES,
    type FileTypeFilter,
    type ImportedPanelFile,
    type PanelFileTransferResult,
} from "../../../shared/fileTransfer";
import { isBrowserShell, shellIpc } from "./shell";

export const FILE_TRANSFER_REQUEST = "paperboard:file-transfer";
export const FILE_TRANSFER_RESULT = "paperboard:file-transfer-result";

export interface PanelFileTransferMessage {
    kind: "export" | "import";
    requestId: string;
    panelId: unknown;
    path: unknown;
    suggestedName?: unknown;
    filters?: unknown;
    selection?: unknown;
}

/** routing fields only; null for anything that is not a dialog request */
export function parseFileTransferMessage(data: unknown): PanelFileTransferMessage | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.type !== FILE_TRANSFER_REQUEST) return null;
    if (message.kind !== "export" && message.kind !== "import") return null;
    if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 128) return null;
    return {
        kind: message.kind,
        requestId: message.requestId,
        panelId: message.panelId,
        path: message.path,
        suggestedName: message.suggestedName,
        filters: message.filters,
        selection: message.selection,
    };
}

function failed(code: Extract<PanelFileTransferResult, { status: "failed" }>["code"], message: string): PanelFileTransferResult {
    return { status: "failed", code, message };
}

export async function runPanelFileTransfer(
    computerId: string,
    framePanelId: string,
    message: PanelFileTransferMessage,
): Promise<PanelFileTransferResult> {
    if (message.panelId !== framePanelId) {
        return failed("invalid-request", "The panel id does not match the panel that asked");
    }
    const request = {
        computerId,
        panelId: framePanelId,
        path: message.path,
        suggestedName: message.suggestedName,
        filters: message.filters,
        selection: message.selection,
    };
    try {
        if (!isBrowserShell()) {
            return await shellIpc().invoke<PanelFileTransferResult>(
                message.kind === "export" ? "panel-file-export" : "panel-file-import",
                request,
            );
        }
        return message.kind === "export" ? await browserSave(request) : await browserOpen(request);
    } catch (err) {
        console.error("[panel-files] file transfer failed:", err);
        return failed("failed", err instanceof Error ? err.message : String(err));
    }
}

// ── browser mode: the browser's own pickers, bytes through the host ──

async function failureFrom(res: Response): Promise<PanelFileTransferResult> {
    try {
        const body = (await res.json()) as PanelFileTransferResult;
        if (body?.status === "failed") return body;
    } catch (err) {
        console.error("[panel-files] unreadable failure response:", err);
    }
    return failed("failed", `The host refused the transfer (HTTP ${res.status})`);
}

function pickerTypes(filters: unknown): { description: string; accept: Record<string, string[]> }[] | undefined {
    if (!Array.isArray(filters)) return undefined;
    return (filters as FileTypeFilter[]).map((f) => ({
        description: String(f?.name ?? ""),
        accept: { "application/octet-stream": (Array.isArray(f?.extensions) ? f.extensions : []).map((ext) => `.${ext}`) },
    }));
}

type SaveHandle = { name: string; createWritable(): Promise<WritableStream<Uint8Array>> };
type SavePicker = (options: { suggestedName?: string; types?: ReturnType<typeof pickerTypes> }) => Promise<SaveHandle>;

async function browserSave(request: Record<string, unknown>): Promise<PanelFileTransferResult> {
    const showSaveFilePicker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (!showSaveFilePicker) {
        return failed("unsupported", "This browser cannot choose where to save a file. Use the Paperboard app or a Chromium-based browser.");
    }
    // the file is checked before the picker opens, and read only once
    // there is a place for it: a read left waiting on the picker would
    // outlive the daemon's idle timeout
    const stat = await fetch("/_shell/panel-file/stat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
    if (!stat.ok) return failureFrom(stat);
    let handle: SaveHandle;
    try {
        const path = typeof request.path === "string" ? request.path : "";
        handle = await showSaveFilePicker({
            suggestedName: typeof request.suggestedName === "string" ? request.suggestedName : path.split("/").pop(),
            types: pickerTypes(request.filters),
        });
    } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return { status: "canceled" };
        throw err;
    }
    const res = await fetch("/_shell/panel-file/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });
    if (!res.ok || !res.body) return failureFrom(res);
    // a writable commits on close; an aborted pipe leaves the old file
    let bytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            bytes += chunk.byteLength;
            controller.enqueue(chunk);
        },
    });
    await res.body.pipeThrough(counter).pipeTo(await handle.createWritable());
    return { status: "exported", name: handle.name, bytes };
}

// <input type=file> works in every browser and reports a cancel
function pickFiles(filters: unknown, mode: "file" | "files" | "folder"): Promise<File[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (mode === "folder") input.webkitdirectory = true;
        else {
            input.multiple = mode === "files";
            const types = pickerTypes(filters);
            if (types) input.accept = types.flatMap((t) => Object.values(t.accept).flat()).join(",");
        }
        input.addEventListener("change", () => resolve(input.files?.length ? [...input.files] : null), { once: true });
        input.addEventListener("cancel", () => resolve(null), { once: true });
        input.click();
    });
}

async function writeToHost(request: Record<string, unknown>, file: File): Promise<PanelFileTransferResult> {
    const res = await fetch(`/_shell/panel-file/write?request=${encodeURIComponent(JSON.stringify(request))}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
    });
    if (!res.ok) return failureFrom(res);
    return (await res.json()) as PanelFileTransferResult;
}

function refused(message: string): PanelFileTransferResult {
    return failed("failed", message);
}

async function browserOpen(request: Record<string, unknown>): Promise<PanelFileTransferResult> {
    const selection = request.selection === "files" || request.selection === "folder" ? request.selection : "file";
    const picked = await pickFiles(request.filters, selection);
    if (!picked) return { status: "canceled" };
    if (selection === "file") {
        const result = await writeToHost(request, picked[0]!);
        return result.status === "imported" ? { ...result, name: picked[0]!.name } : result;
    }

    // a folder arrives as files named by their path below it; the same
    // names and limits as the desktop shell's
    const folder = selection === "folder" ? picked[0]!.webkitRelativePath.split("/")[0]! : "";
    const planned = picked.map((file) => ({
        file,
        name: selection === "folder" ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name,
    }));
    if (planned.length > PANEL_IMPORT_MAX_FILES) return refused(`Choose at most ${PANEL_IMPORT_MAX_FILES} files`);
    if (planned.reduce((sum, item) => sum + item.file.size, 0) > PANEL_IMPORT_MAX_BYTES) {
        return refused(`The files are larger than Paperboard copies (${PANEL_IMPORT_MAX_BYTES} bytes)`);
    }
    if (selection === "folder" && !isImportableName(folder)) return refused(`"${folder}" has a name that cannot be copied`);
    const seen = new Set<string>();
    for (const item of planned) {
        if (!item.name.split("/").every(isImportableName)) return refused(`"${item.name}" has a name that cannot be copied`);
        if (seen.has(item.name)) return refused(`Two chosen files are both called "${item.name}"`);
        seen.add(item.name);
    }

    const base = String(request.path).replace(/\/+$/, "") + (selection === "folder" ? `/${folder}` : "");
    const files: ImportedPanelFile[] = [];
    let bytes = 0;
    for (const item of planned) {
        const result = await writeToHost({ ...request, path: `${base}/${item.name}` }, item.file);
        if (result.status === "failed") {
            return { ...result, message: `${item.name}: ${result.message}${files.length ? ` (${files.length === 1 ? "1 file was" : `${files.length} files were`} already copied)` : ""}` };
        }
        files.push({ name: item.name, bytes: item.file.size });
        bytes += item.file.size;
    }
    const name = selection === "folder" ? folder : files.length === 1 ? files[0]!.name : `${files.length} files`;
    return { status: "imported", name, bytes, files };
}
