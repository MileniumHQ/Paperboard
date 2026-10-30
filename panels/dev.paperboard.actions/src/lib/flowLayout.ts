// Where flows sit on a canvas without being drawn: a generous estimate of
// the room each flow and note takes, so a flow added by a program lands
// clear of everything already there, and the home screen can draw a
// project's canvas in miniature. Estimates err large: a gap is harmless,
// an overlap is not.
import type { CanvasBlock } from "./tree";

// the widest a block draws (--actions-action-max, plus a container's frame)
export const FLOW_WIDTH = 520;
/** one step's row, with room for an input that wraps once */
export const STEP_HEIGHT = 72;
/** a container's header and footer around its steps */
const CONTAINER_CHROME = 56;
const INDENT = 24;
export const NOTE_WIDTH = 260;
export const NOTE_HEIGHT = 400;
/** room left between an added flow and what was there */
export const FLOW_GAP = 80;
/** a canvas starts here, clear of the open Library */
export const CANVAS_ORIGIN = { x: 420, y: 80 };

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function stepsHeight(steps: CanvasBlock[] | undefined, depth: number): { h: number; w: number } {
    let h = 0;
    let w = 0;
    for (const step of steps ?? []) {
        const size = blockSize(step, depth);
        h += size.h;
        w = Math.max(w, size.w);
    }
    return { h, w };
}

function blockSize(block: CanvasBlock, depth: number): { w: number; h: number } {
    const isContainer = Array.isArray(block.children) || Array.isArray(block.elseChildren);
    if (!isContainer) return { w: FLOW_WIDTH, h: STEP_HEIGHT };
    const inner = stepsHeight(block.children, depth + 1);
    const otherwise = stepsHeight(block.elseChildren, depth + 1);
    const branches = Array.isArray(block.elseChildren) ? 2 : 1;
    return {
        w: Math.max(FLOW_WIDTH, Math.max(inner.w, otherwise.w) + INDENT),
        h: STEP_HEIGHT + CONTAINER_CHROME * branches + Math.max(inner.h, STEP_HEIGHT) + (branches === 2 ? Math.max(otherwise.h, STEP_HEIGHT) : 0),
    };
}

/** The room one top-level flow takes on the canvas. */
export function flowRect(flow: CanvasBlock): Rect {
    const size = blockSize(flow, 0);
    return { x: flow.pos?.x ?? 0, y: flow.pos?.y ?? 0, w: size.w, h: size.h };
}

export function noteRect(note: { pos: { x: number; y: number } }): Rect {
    return { x: note.pos.x, y: note.pos.y, w: NOTE_WIDTH, h: NOTE_HEIGHT };
}

export function canvasRects(flows: CanvasBlock[], notes: readonly unknown[]): Rect[] {
    const placedNotes = notes.filter(
        (n): n is { pos: { x: number; y: number } } =>
            Boolean(n && typeof n === "object" && Number.isFinite((n as any).pos?.x) && Number.isFinite((n as any).pos?.y)),
    );
    return [...flows.map(flowRect), ...placedNotes.map(noteRect)];
}

const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w + FLOW_GAP && b.x < a.x + a.w + FLOW_GAP && a.y < b.y + b.h + FLOW_GAP && b.y < a.y + a.h + FLOW_GAP;

/**
 * Where a flow of this size goes: the first free spot in reading order, on
 * a grid of flow-wide columns, so new flows fill a row before starting the
 * next instead of trailing off to one side.
 */
export function placeFlow(existing: readonly Rect[], size: { w: number; h: number }, columns = 3): { x: number; y: number } {
    const columnWidth = FLOW_WIDTH + FLOW_GAP;
    const top = CANVAS_ORIGIN.y;
    const bottom = existing.reduce((max, r) => Math.max(max, r.y + r.h), top);
    for (let y = top; y <= bottom + FLOW_GAP; y += STEP_HEIGHT) {
        for (let c = 0; c < columns; c++) {
            const spot = { x: CANVAS_ORIGIN.x + c * columnWidth, y, w: size.w, h: size.h };
            if (!existing.some((r) => overlaps(spot, r))) return { x: spot.x, y: spot.y };
        }
    }
    return { x: CANVAS_ORIGIN.x, y: bottom + FLOW_GAP };
}

/** Most rectangles a home-screen preview draws; the rest would be specks. */
export const MAX_PREVIEW_RECTS = 40;

export interface CanvasPreview {
    /** the canvas area the rectangles sit in */
    bounds: Rect;
    rects: (Rect & { kind: "flow" | "note" })[];
}

/** A project's canvas in miniature, for its card on the home screen. */
export function canvasPreview(flows: CanvasBlock[], notes: readonly unknown[]): CanvasPreview | null {
    const rects = [
        ...flows.filter((f) => f.isTrigger).map((f) => ({ ...flowRect(f), kind: "flow" as const })),
        ...canvasRects([], notes).map((r) => ({ ...r, kind: "note" as const })),
    ].slice(0, MAX_PREVIEW_RECTS);
    if (rects.length === 0) return null;
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    return { bounds: { x, y, w: right - x, h: bottom - y }, rects };
}
