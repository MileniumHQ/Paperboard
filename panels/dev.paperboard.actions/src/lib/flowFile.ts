// Flow files: the canvas (flows, notes, functions) written out to share or
// keep, and read back in. Reading one back adds its flows next to the ones
// already on the canvas; nothing there is replaced. Every block, note and
// function gets a new id, and the file's own references (variable chips,
// function calls) move with them, so importing the same file twice gives
// two independent copies.

import type { CanvasDocument } from "./canvasDoc";
import {
    buildCallSchema,
    buildTriggerSchema,
    functionIdFromCallAction,
    functionIdFromTriggerAction,
    type FunctionDef,
} from "./functions";
import { withoutRemovedSteps } from "./removedSteps";
import { isCanvasBlock, walkBlocks, type CanvasBlock } from "./tree";

export const FLOW_FILE_FORMAT = "paperboard.actions.flows";
export const FLOW_FILE_VERSION = 1;
/** a flow file is text someone made by hand on a canvas; bigger is not one */
export const MAX_FLOW_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FLOW_FILE_ITEMS = 5_000;
/** room between what is on the canvas and what an import adds below it */
const IMPORT_GAP = 160;

interface Note {
    id: string;
    pos: { x: number; y: number };
    zIndex?: number;
    text: string;
}

export function flowFileText(canvas: CanvasDocument): string {
    return JSON.stringify(
        { format: FLOW_FILE_FORMAT, version: FLOW_FILE_VERSION, flows: canvas.flows, notes: canvas.notes, functions: canvas.functions },
        null,
        2,
    );
}

const isPos = (p: any) => p && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y);
const isNote = (n: any): n is Note => n && typeof n === "object" && typeof n.id === "string" && isPos(n.pos) && typeof n.text === "string";
const isFunction = (f: any): f is FunctionDef =>
    f && typeof f === "object" && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.params)
    && f.params.every((p: any) => p && typeof p.name === "string" && typeof p.type === "string");

/** Reads a flow file; throws a reason a person can act on when it is not one. */
export function parseFlowFile(text: string): CanvasDocument {
    if (text.length > MAX_FLOW_FILE_BYTES) throw new Error("This file is too big to be a flow file.");
    let data: any;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("This file is not a flow file: it is not JSON.");
    }
    if (data?.format !== FLOW_FILE_FORMAT) throw new Error("This file is not a flow file exported from Actions.");
    if (data.version !== FLOW_FILE_VERSION) throw new Error(`This flow file is version ${String(data.version)}; this Actions reads version ${FLOW_FILE_VERSION}. Update Actions and try again.`);
    const flows = data.flows ?? [];
    const notes = data.notes ?? [];
    const functions = data.functions ?? [];
    if (!Array.isArray(flows) || !Array.isArray(notes) || !Array.isArray(functions)) throw new Error("This flow file is damaged.");
    if (flows.length + notes.length + functions.length > MAX_FLOW_FILE_ITEMS) throw new Error("This flow file has more flows than Actions can add at once.");
    if (!flows.every((f) => isCanvasBlock(f) && isPos(f.pos))) throw new Error("This flow file has a damaged flow.");
    if (!notes.every(isNote)) throw new Error("This flow file has a damaged note.");
    if (!functions.every(isFunction)) throw new Error("This flow file has a damaged function.");
    if (flows.length + notes.length + functions.length === 0) throw new Error("This flow file is empty.");
    return { flows, notes, functions };
}

function uniqueName(name: string, taken: Set<string>): string {
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

function lowestEdge(items: { pos: { x: number; y: number } }[]): number | null {
    return items.length ? Math.max(...items.map((i) => i.pos.y)) : null;
}

/**
 * The canvas with the file's flows, notes and functions added below what is
 * already there, and no further left than `minX` (clear of the open
 * Library). `newId` makes one fresh id; tests pass a counter.
 */
export function addFlowFile(
    canvas: CanvasDocument,
    file: CanvasDocument,
    newId: (kind: "block" | "note" | "fn") => string,
    minX = 0,
): CanvasDocument {
    // TODO(remove after v0.4): a file written before 0.3 may hold steps 0.3 removed
    file = { ...file, flows: withoutRemovedSteps(file.flows).flows };
    const blockIds = new Map<string, string>();
    walkBlocks(file.flows, (b) => {
        if (!blockIds.has(b.id)) blockIds.set(b.id, newId("block"));
        return b;
    });

    const names = new Set(canvas.functions.map((f) => f.name));
    const fnIds = new Map<string, string>();
    const functions = file.functions.map((f) => {
        const id = newId("fn");
        fnIds.set(f.id, id);
        const name = uniqueName(f.name, names);
        names.add(name);
        return { ...f, id, name, params: f.params.map((p) => ({ ...p })) };
    });
    const fnById = new Map(functions.map((f) => [f.id, f]));

    // a chip is {{token:label:icon}}; only tokens naming one of the file's
    // blocks move, variable names and payload paths stay as written
    const rewrite = (value: unknown): unknown => {
        if (typeof value === "string") {
            return value.replace(/\{\{([^{}]+)\}\}/g, (whole, inner: string) => {
                const cut = inner.indexOf(":");
                const token = cut < 0 ? inner : inner.slice(0, cut);
                const moved = blockIds.get(token.trim());
                return moved ? `{{${moved}${cut < 0 ? "" : inner.slice(cut)}}}` : whole;
            });
        }
        if (Array.isArray(value)) return value.map(rewrite);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
        }
        return value;
    };

    const top = [...canvas.flows, ...(canvas.notes as Note[])];
    const incoming = [...file.flows, ...(file.notes as Note[])];
    const bottom = lowestEdge(top);
    const fileTop = incoming.length ? Math.min(...incoming.map((i) => i.pos.y)) : 0;
    const dy = bottom === null ? 0 : bottom + IMPORT_GAP - fileTop;
    const fileLeft = incoming.length ? Math.min(...incoming.map((i) => i.pos.x)) : minX;
    const dx = Math.max(0, minX - fileLeft);

    const moved = walkBlocks(file.flows, (b) => {
        const actionId = String(b.action?.id ?? "");
        const callFn = functionIdFromCallAction(actionId);
        const triggerFn = functionIdFromTriggerAction(actionId);
        let action = b.action;
        if (callFn && fnIds.has(callFn)) {
            action = buildCallSchema(fnById.get(fnIds.get(callFn)!)!);
        } else if (triggerFn && fnIds.has(triggerFn)) {
            action = buildTriggerSchema(fnById.get(fnIds.get(triggerFn)!)!);
        }
        return { ...b, id: blockIds.get(b.id)!, action, values: rewrite(b.values ?? {}) as Record<string, any> };
    }).map((b): CanvasBlock => ({ ...b, pos: { x: b.pos.x + dx, y: b.pos.y + dy } }));

    const notes = (file.notes as Note[]).map((n) => ({ ...n, id: newId("note"), pos: { x: n.pos.x + dx, y: n.pos.y + dy } }));

    return {
        flows: [...canvas.flows, ...moved],
        notes: [...canvas.notes, ...notes],
        functions: [...canvas.functions, ...functions],
    };
}

/** room left around imported items when the canvas scrolls to them */
export const REVEAL_MARGIN = 40;

/**
 * Where to scroll the canvas so the top-left of `items` shows just clear of
 * the left `covered` pixels (the open Library). Null when there are none.
 * The browser clamps a scroll past either edge.
 */
export function revealScroll(items: readonly { pos: { x: number; y: number } }[], covered: number): { left: number; top: number } | null {
    if (!items.length) return null;
    const x = Math.min(...items.map((i) => i.pos.x));
    const y = Math.min(...items.map((i) => i.pos.y));
    return { left: Math.max(0, x - covered - REVEAL_MARGIN), top: Math.max(0, y - REVEAL_MARGIN) };
}
