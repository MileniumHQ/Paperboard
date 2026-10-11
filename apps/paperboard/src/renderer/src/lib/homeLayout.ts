// Home layout: widgets placed on a dot grid that is secretly cut into
// columns WIDGET_MAX_WIDTH cells wide. A widget lives in one column and
// never spans two. When the window can't fit every column side by side,
// the rest wrap below and Home scrolls. Pure functions: HomeView owns the
// signals, this owns the rules.

import { parseWidgetSize, WIDGET_MAX_WIDTH, isWidgetId, type WidgetSize } from "@mileniumhq/paperapi";

export const HOME_LAYOUT_ID = "shell-home-layout";
/** Home spans every computer, so its layout is this machine's, never a remote's. */
export const HOME_LAYOUT_COMPUTER = "local";
export const HOME_LAYOUT_VERSION = 1;
export const COLUMN_CELLS = WIDGET_MAX_WIDTH;
export const MAX_COLUMNS = 8;
export const MAX_ROWS = 32;
export const MAX_HOME_ITEMS = 32;
export const MIN_CELL = 96;
export const MAX_CELL = 132;
/** Below MIN_CELL a single column scales down rather than overflow, to this floor. */
export const FLOOR_CELL = 48;

interface HomeItemBase {
    /** instance id: two copies of one widget are two items */
    id: string;
    /** the computer the widget shows, or whose panel serves it */
    computerId: string;
    widgetId: string;
    size: string;
    column: number;
    x: number;
    y: number;
}

/** A widget Paperboard draws itself, or one a panel serves. */
export type HomeItem = HomeItemBase & ({ source: "builtin" } | { source: "panel"; panelId: string });

export interface HomeLayoutDoc {
    version: typeof HOME_LAYOUT_VERSION;
    items: HomeItem[];
}

export interface Placement {
    column: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

const INSTANCE_ID = /^[A-Za-z0-9-]{1,64}$/;
const COMPUTER_ID = /^[A-Za-z0-9._-]{1,128}$/;
const PANEL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function sizeOf(item: Pick<HomeItem, "size">): WidgetSize {
    return parseWidgetSize(item.size) ?? { w: 1, h: 1 };
}

export function placementOf(item: HomeItem): Placement {
    const { w, h } = sizeOf(item);
    return { column: item.column, x: item.x, y: item.y, w, h };
}

/**
 * Reads the stored document. null (never saved) is an empty Home; anything
 * else that doesn't parse throws, so a damaged layout is reported instead
 * of being treated as empty and overwritten by the next save.
 */
export function parseHomeLayout(raw: unknown): HomeItem[] {
    if (raw === null || raw === undefined) return [];
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Home layout is not an object");
    const doc = raw as Record<string, unknown>;
    if (doc.version !== HOME_LAYOUT_VERSION) {
        throw new Error(`Home layout version ${String(doc.version)} is not one this Paperboard reads`);
    }
    if (!Array.isArray(doc.items) || doc.items.length > MAX_HOME_ITEMS) {
        throw new Error("Home layout items are missing or too many");
    }
    const items: HomeItem[] = doc.items.map((entry, index) => {
        const item = entry as Record<string, unknown> | null;
        const ok =
            item &&
            typeof item.id === "string" && INSTANCE_ID.test(item.id) &&
            typeof item.computerId === "string" && COMPUTER_ID.test(item.computerId) &&
            (item.source === "builtin" || (item.source === "panel" && typeof item.panelId === "string" && PANEL_ID.test(item.panelId))) &&
            isWidgetId(item.widgetId) &&
            parseWidgetSize(item.size) !== null &&
            Number.isInteger(item.column) && Number.isInteger(item.x) && Number.isInteger(item.y);
        if (!ok) throw new Error(`Home layout item ${index} is malformed`);
        const base = {
            id: item.id as string,
            computerId: item.computerId as string,
            widgetId: item.widgetId as string,
            size: item.size as string,
            column: item.column as number,
            x: item.x as number,
            y: item.y as number,
        };
        return item.source === "builtin"
            ? { ...base, source: "builtin" as const }
            : { ...base, source: "panel" as const, panelId: item.panelId as string };
    });
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== items.length) throw new Error("Home layout repeats an item id");
    for (const item of items) {
        if (!inBounds(placementOf(item))) throw new Error(`Home layout item ${item.id} is off the grid`);
    }
    return items;
}

export function serializeHomeLayout(items: HomeItem[]): HomeLayoutDoc {
    return { version: HOME_LAYOUT_VERSION, items: items.map((item) => ({ ...item })) };
}

export function inBounds(p: Placement): boolean {
    return (
        p.column >= 0 && p.column < MAX_COLUMNS &&
        p.x >= 0 && p.x + p.w <= COLUMN_CELLS &&
        p.y >= 0 && p.y + p.h <= MAX_ROWS
    );
}

function overlaps(a: Placement, b: Placement): boolean {
    return a.column === b.column && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when `p` is on the grid and touches no item other than `ignoreId`. */
export function canPlace(items: HomeItem[], p: Placement, ignoreId?: string): boolean {
    if (!inBounds(p)) return false;
    return items.every((item) => item.id === ignoreId || !overlaps(p, placementOf(item)));
}

/** First free spot for a widget, column by column, top to bottom. */
export function findFreeSpot(items: HomeItem[], size: WidgetSize, columns: number): Placement | null {
    for (let column = 0; column < Math.min(Math.max(columns, 1), MAX_COLUMNS); column++) {
        for (let y = 0; y + size.h <= MAX_ROWS; y++) {
            for (let x = 0; x + size.w <= COLUMN_CELLS; x++) {
                const p = { column, x, y, ...size };
                if (canPlace(items, p)) return p;
            }
        }
    }
    return null;
}

export interface HomeGeometry {
    /** columns that fit side by side */
    fit: number;
    /** px per cell */
    cell: number;
    /** columns drawn: every column in use, and at least the ones that fit */
    columns: number;
}

/**
 * Cells flex between MIN_CELL and MAX_CELL before a column wraps, so a small
 * resize changes cell size, not the layout. One column narrower than
 * MIN_CELL cells scales down instead.
 */
export function computeGeometry(width: number, items: HomeItem[]): HomeGeometry {
    const available = Math.max(width, 0);
    const fit = Math.min(MAX_COLUMNS, Math.max(1, Math.floor(available / (COLUMN_CELLS * MIN_CELL))));
    const cell = Math.max(FLOOR_CELL, Math.min(MAX_CELL, available / (fit * COLUMN_CELLS)));
    const used = items.reduce((max, item) => Math.max(max, item.column + 1), 0);
    return { fit, cell, columns: Math.min(MAX_COLUMNS, Math.max(fit, used)) };
}

/**
 * How the canvas is drawn in `room` px of width: at full size when it fits,
 * otherwise smaller, down to MIN_CANVAS_SCALE, and centered in what's left.
 * Opening the gallery takes room from Home without rearranging it.
 */
export const MIN_CANVAS_SCALE = 0.4;
export function fitCanvas(gridWidth: number, room: number): { scale: number; left: number } {
    const space = Math.max(room, 0);
    const scale = gridWidth > 0 ? Math.min(1, Math.max(MIN_CANVAS_SCALE, space / gridWidth)) : 1;
    return { scale, left: Math.max(0, (space - gridWidth * scale) / 2) };
}

/** Rows each band of columns needs: its tallest column, plus `extra`. */
export function bandRows(items: HomeItem[], geometry: HomeGeometry, extra: number): number[] {
    const bands = Math.ceil(geometry.columns / geometry.fit);
    const rows = Array.from({ length: bands }, () => 1);
    for (const item of items) {
        const band = Math.floor(item.column / geometry.fit);
        if (band < bands) rows[band] = Math.max(rows[band], item.y + sizeOf(item).h);
    }
    return rows.map((r) => Math.min(MAX_ROWS, r + extra));
}

/** Where a column's cell (0, 0) is drawn, in px from the grid's corner. */
export function columnOrigin(column: number, geometry: HomeGeometry, rows: number[]): { left: number; top: number } {
    const band = Math.floor(column / geometry.fit);
    const slot = column % geometry.fit;
    let top = 0;
    for (let b = 0; b < band; b++) top += (rows[b] ?? 1) * geometry.cell;
    return { left: slot * COLUMN_CELLS * geometry.cell, top };
}

/**
 * Snaps a widget whose top-left corner is at (left, top) px in grid space.
 * The column is the one under the widget's center, so a widget dropped
 * across a column boundary lands in the column holding most of it.
 */
export function snapToGrid(
    left: number,
    top: number,
    size: WidgetSize,
    geometry: HomeGeometry,
    rows: number[],
): Placement | null {
    const { cell, fit } = geometry;
    const centerX = left + (size.w * cell) / 2;
    const centerY = top + (size.h * cell) / 2;
    if (centerX < 0 || centerX >= fit * COLUMN_CELLS * cell || centerY < 0) return null;
    let band = 0;
    let bandTop = 0;
    while (band < rows.length - 1 && centerY >= bandTop + rows[band] * cell) {
        bandTop += rows[band] * cell;
        band++;
    }
    const slot = Math.floor(centerX / (COLUMN_CELLS * cell));
    const column = band * fit + slot;
    const x = Math.min(COLUMN_CELLS - size.w, Math.max(0, Math.round((left - slot * COLUMN_CELLS * cell) / cell)));
    const y = Math.max(0, Math.round((top - bandTop) / cell));
    return { column, x, y, ...size };
}

/**
 * Keyboard move by one cell. Left and right cross into the neighboring
 * column at its edge; up and down stay in the column.
 */
export function stepPlacement(p: Placement, dx: number, dy: number): Placement {
    let { column, x } = p;
    const y = p.y + dy;
    x += dx;
    if (x < 0 && column > 0) {
        column -= 1;
        x = COLUMN_CELLS - p.w;
    } else if (x + p.w > COLUMN_CELLS && column < MAX_COLUMNS - 1) {
        column += 1;
        x = 0;
    }
    return { ...p, column, x, y };
}
