// The canvas document (flows, notes, functions) has one owner: the Actions
// service. Every window saves through it and names the revision its edit was
// made on; a save made on an older revision than the stored one is refused,
// so one window can never silently write over another's edit. Each accepted
// save bumps the revision and is announced, and the other windows pull it.
// Storage and apply are injected so the rules run without a daemon.

import type { FunctionDef } from "./functions";
import type { CanvasBlock } from "./tree";

export interface CanvasDocument {
    flows: CanvasBlock[];
    notes: unknown[];
    functions: FunctionDef[];
}

export interface CanvasSnapshot {
    revision: number;
    canvas: CanvasDocument;
}

export interface CanvasSaveResult {
    revision: number;
    /** set when the canvas was saved but its flows could not be applied */
    applyError?: string;
}

/** Service → windows: a new canvas revision was saved (payload: revision, clientId). */
export const CANVAS_CHANGED_EVENT = "canvas-changed";

/** Marks a refused stale save so the window can tell it from other failures. */
export const CANVAS_CONFLICT = "canvas-conflict";

export class CanvasConflictError extends Error {
    constructor(readonly current: number) {
        super(`${CANVAS_CONFLICT}: the canvas changed in another window (now revision ${current})`);
        this.name = "CanvasConflictError";
    }
}

export function isCanvasConflict(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(CANVAS_CONFLICT);
}

export function emptyCanvas(): CanvasDocument {
    return { flows: [], notes: [], functions: [] };
}

function revisionOf(saved: any): number {
    return Number.isSafeInteger(saved?.revision) && saved.revision >= 0 ? saved.revision : 0;
}

export function createCanvasDocument(deps: {
    read: () => Promise<unknown>;
    write: (doc: CanvasDocument & { revision: number }) => Promise<void>;
    /** validates the definitions; throws to refuse the save before any write */
    validate: (canvas: CanvasDocument) => CanvasDocument;
    /** activates the saved flows; a throw means saved, not applied */
    apply: (canvas: CanvasDocument) => Promise<void>;
    onChanged: (change: { revision: number; clientId: string }) => void;
}) {
    let current: CanvasSnapshot = { revision: 0, canvas: emptyCanvas() };
    // unreadable is not empty: until the stored canvas is read, nothing may
    // be written over it
    let loadError: string | null = "The canvas has not been loaded yet.";
    let queue: Promise<unknown> = Promise.resolve();

    const serial = <T>(op: () => Promise<T>): Promise<T> => {
        const next = queue.then(op, op);
        queue = next.catch(() => undefined);
        return next;
    };

    const api = {
        /** Reads the stored canvas. Missing is empty; unreadable is refused. */
        load(): Promise<CanvasSnapshot> {
            return serial(async () => {
                try {
                    const saved = (await deps.read()) as any;
                    current = {
                        revision: revisionOf(saved),
                        canvas: {
                            flows: Array.isArray(saved?.flows) ? saved.flows : [],
                            notes: Array.isArray(saved?.notes) ? saved.notes : [],
                            functions: Array.isArray(saved?.functions)
                                ? saved.functions.filter((f: any) => f && typeof f.id === "string" && typeof f.name === "string")
                                : [],
                        },
                    };
                    loadError = null;
                    return current;
                } catch (err) {
                    loadError = `The stored canvas could not be read: ${err instanceof Error ? err.message : String(err)}`;
                    throw new Error(loadError);
                }
            });
        },

        /** The canvas now; a canvas that could not be read is read again. */
        async get(): Promise<CanvasSnapshot> {
            if (loadError) return api.load();
            return current;
        },

        /**
         * Saves a window's canvas made on `baseRevision`. Refused when another
         * save landed first; the window reloads instead of overwriting it.
         */
        save(input: { canvas: CanvasDocument; baseRevision: number; clientId: string }): Promise<CanvasSaveResult> {
            return serial(async () => {
                if (loadError) throw new Error(loadError);
                if (input.baseRevision !== current.revision) throw new CanvasConflictError(current.revision);
                const canvas = deps.validate(input.canvas);
                const revision = current.revision + 1;
                await deps.write({ ...canvas, revision });
                current = { revision, canvas };
                let applyError: string | undefined;
                try {
                    await deps.apply(canvas);
                } catch (err) {
                    applyError = err instanceof Error ? err.message : String(err);
                }
                deps.onChanged({ revision, clientId: input.clientId });
                return applyError === undefined ? { revision } : { revision, applyError };
            });
        },
    };
    return api;
}
