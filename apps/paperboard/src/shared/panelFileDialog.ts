// The save and open dialogs a panel asks the shell for. The shell fills in
// computerId and panelId from the frame that asked; the panel only names a
// path in its own file storage and how the dialog should look. Electron
// main and the browser-mode host both parse with this one function.
import { isPanelId } from "../../../../packages/paperapi/src/panelIdentity";

export interface FileDialogFilter {
    name: string;
    extensions: string[];
}

export interface PanelFileDialogRequest {
    computerId: string;
    panelId: string;
    /** a path in the panel's own file storage on that computer */
    path: string;
    /** save only: the file name the dialog starts with */
    suggestedName?: string;
    filters: FileDialogFilter[];
}

export type PanelFileDialogFailure =
    | "invalid-request"
    | "busy"
    | "not-found"
    | "too-large"
    | "unreachable"
    | "unsupported"
    | "failed";

export type PanelFileDialogResult =
    | { status: "saved"; name: string; bytes: number }
    | { status: "opened"; name: string; bytes: number }
    | { status: "canceled" }
    | { status: "failed"; code: PanelFileDialogFailure; message: string };

export class PanelFileDialogError extends Error {
    constructor(
        readonly code: PanelFileDialogFailure,
        message: string,
    ) {
        super(message);
    }
}

export const PANEL_FILE_PATH_MAX = 1024;
const NAME_MAX = 255;
const FILTERS_MAX = 16;
const EXTENSIONS_MAX = 32;
const EXTENSION_RE = /^[A-Za-z0-9]{1,16}$/;

function invalid(message: string): never {
    throw new PanelFileDialogError("invalid-request", message);
}

function field(args: unknown, key: string): unknown {
    return args && typeof args === "object" ? (args as Record<string, unknown>)[key] : undefined;
}

function parseFilters(raw: unknown): FileDialogFilter[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > FILTERS_MAX) invalid(`filters must be a list of at most ${FILTERS_MAX}`);
    return raw.map((filter) => {
        const name = field(filter, "name");
        const extensions = field(filter, "extensions");
        if (typeof name !== "string" || !name.trim() || name.length > NAME_MAX) invalid("Each filter needs a name");
        if (!Array.isArray(extensions) || extensions.length === 0 || extensions.length > EXTENSIONS_MAX) {
            invalid(`Filter "${name}" needs between 1 and ${EXTENSIONS_MAX} extensions`);
        }
        for (const ext of extensions) {
            if (typeof ext !== "string" || !EXTENSION_RE.test(ext)) {
                invalid(`Filter "${name}" has an invalid extension; use letters and digits without the dot`);
            }
        }
        return { name, extensions: [...extensions] as string[] };
    });
}

/** The one shape check for a dialog request; throws PanelFileDialogError. */
export function parsePanelFileDialogRequest(args: unknown): PanelFileDialogRequest {
    const computerId = field(args, "computerId");
    const panelId = field(args, "panelId");
    const path = field(args, "path");
    const suggestedName = field(args, "suggestedName");
    // which computers exist is the connection pool's answer, not a pattern's
    if (typeof computerId !== "string" || !computerId || computerId.length > 128) invalid("Invalid computer id");
    if (!isPanelId(panelId)) invalid("Invalid panel id");
    if (typeof path !== "string" || !path.trim() || path.length > PANEL_FILE_PATH_MAX || path.includes("\0")) {
        invalid(`path must be a file path in the panel's storage, at most ${PANEL_FILE_PATH_MAX} characters`);
    }
    if (
        suggestedName !== undefined &&
        (typeof suggestedName !== "string" || !suggestedName.trim() || suggestedName.length > NAME_MAX || /[\\/\0]/.test(suggestedName))
    ) {
        invalid("suggestedName must be a file name without slashes");
    }
    return {
        computerId,
        panelId,
        path,
        ...(suggestedName !== undefined ? { suggestedName: suggestedName as string } : {}),
        filters: parseFilters(field(args, "filters")),
    };
}

export function failedResult(err: unknown): PanelFileDialogResult {
    if (err instanceof PanelFileDialogError) return { status: "failed", code: err.code, message: err.message };
    return { status: "failed", code: "failed", message: err instanceof Error ? err.message : String(err) };
}
