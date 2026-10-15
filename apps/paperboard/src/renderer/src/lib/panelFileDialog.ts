// A panel frame asks for a save or open dialog with
// { type: "paperboard:file-dialog", generation, requestId, kind, panelId, path, ... }.
// The shell answers on the same frame with "paperboard:file-dialog-result".
// Identity comes from the frame the message arrived on; the panelId the
// panel names must agree with it. The request's fields are checked once,
// by the host that runs the dialog (src/shared/panelFileDialog.ts).
import type { FileDialogFilter, PanelFileDialogResult } from "../../../shared/panelFileDialog";
import { isBrowserShell, shellIpc } from "./shell";

export const FILE_DIALOG_REQUEST = "paperboard:file-dialog";
export const FILE_DIALOG_RESULT = "paperboard:file-dialog-result";

export interface PanelFileDialogMessage {
    kind: "save" | "open";
    requestId: string;
    panelId: unknown;
    path: unknown;
    suggestedName?: unknown;
    filters?: unknown;
}

/** routing fields only; null for anything that is not a dialog request */
export function parseFileDialogMessage(data: unknown): PanelFileDialogMessage | null {
    if (!data || typeof data !== "object") return null;
    const message = data as Record<string, unknown>;
    if (message.type !== FILE_DIALOG_REQUEST) return null;
    if (message.kind !== "save" && message.kind !== "open") return null;
    if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 128) return null;
    return {
        kind: message.kind,
        requestId: message.requestId,
        panelId: message.panelId,
        path: message.path,
        suggestedName: message.suggestedName,
        filters: message.filters,
    };
}

function failed(code: Extract<PanelFileDialogResult, { status: "failed" }>["code"], message: string): PanelFileDialogResult {
    return { status: "failed", code, message };
}

export async function runPanelFileDialog(
    computerId: string,
    framePanelId: string,
    message: PanelFileDialogMessage,
): Promise<PanelFileDialogResult> {
    if (message.panelId !== framePanelId) {
        return failed("invalid-request", "The panel id does not match the panel that asked");
    }
    const request = {
        computerId,
        panelId: framePanelId,
        path: message.path,
        suggestedName: message.suggestedName,
        filters: message.filters,
    };
    try {
        if (!isBrowserShell()) {
            return await shellIpc().invoke<PanelFileDialogResult>(
                message.kind === "save" ? "panel-file-save" : "panel-file-open",
                request,
            );
        }
        return message.kind === "save" ? await browserSave(request) : await browserOpen(request);
    } catch (err) {
        console.error("[panel-files] file dialog failed:", err);
        return failed("failed", err instanceof Error ? err.message : String(err));
    }
}

// ── browser mode: the browser's own pickers, bytes through the host ──

async function failureFrom(res: Response): Promise<PanelFileDialogResult> {
    try {
        const body = (await res.json()) as PanelFileDialogResult;
        if (body?.status === "failed") return body;
    } catch (err) {
        console.error("[panel-files] unreadable failure response:", err);
    }
    return failed("failed", `The host refused the transfer (HTTP ${res.status})`);
}

function pickerTypes(filters: unknown): { description: string; accept: Record<string, string[]> }[] | undefined {
    if (!Array.isArray(filters)) return undefined;
    return (filters as FileDialogFilter[]).map((f) => ({
        description: String(f?.name ?? ""),
        accept: { "application/octet-stream": (Array.isArray(f?.extensions) ? f.extensions : []).map((ext) => `.${ext}`) },
    }));
}

type SaveHandle = { name: string; createWritable(): Promise<WritableStream<Uint8Array>> };
type SavePicker = (options: { suggestedName?: string; types?: ReturnType<typeof pickerTypes> }) => Promise<SaveHandle>;

async function browserSave(request: Record<string, unknown>): Promise<PanelFileDialogResult> {
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
    return { status: "saved", name: handle.name, bytes };
}

// <input type=file> works in every browser and reports a cancel
function pickFile(filters: unknown): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        const types = pickerTypes(filters);
        if (types) input.accept = types.flatMap((t) => Object.values(t.accept).flat()).join(",");
        input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => resolve(null), { once: true });
        input.click();
    });
}

async function browserOpen(request: Record<string, unknown>): Promise<PanelFileDialogResult> {
    const file = await pickFile(request.filters);
    if (!file) return { status: "canceled" };
    const res = await fetch(`/_shell/panel-file/write?request=${encodeURIComponent(JSON.stringify(request))}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
    });
    if (!res.ok) return failureFrom(res);
    const result = (await res.json()) as PanelFileDialogResult;
    return result.status === "opened" ? { ...result, name: file.name } : result;
}
