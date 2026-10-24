// Home layout: widgets placed anywhere on one dot grid, never overlapping.
// The grid is as wide as the window fits and at least as wide as the
// layout; a layout wider than the window is drawn smaller rather than
// rearranged, so Home looks the same on every window. Pure functions:
// HomeView owns the signals, this owns the rules.

import { parseWidgetOptionValues, parseWidgetSize, WIDGET_MAX_WIDTH, isWidgetId, type WidgetOptionValues, type WidgetSize } from "@mileniumhq/paperapi";

export const HOME_LAYOUT_ID = "shell-home-layout";
/** Home spans every computer, so its layout is this machine's, never a remote's. */
export const HOME_LAYOUT_COMPUTER = "local";
export const HOME_LAYOUT_VERSION = 2;
/** The window gains and loses cells this many at a time, so cells stay a steady size. */
export const CELL_STEP = WIDGET_MAX_WIDTH;
export const MAX_CELLS_ACROSS = 32;
export const MAX_ROWS = 32;
export const MAX_HOME_ITEMS = 32;
export const MIN_CELL = 96;
export const MAX_CELL = 132;
/** Below MIN_CELL the narrowest grid scales down rather than overflow, to this floor. */
export const FLOOR_CELL = 48;

interface HomeItemBase {
    /** instance id: two copies of one widget are two items */
    id: string;
    /** the computer the widget shows, or whose panel serves it */
    computerId: string;
    widgetId: string;
    size: string;
    /** cells from the grid's left edge and top */
    x: number;
    y: number;
}

/**
 * A widget Paperboard draws itself, or one a panel serves. `options` is what
 * was chosen in the gallery, when the widget declares options.
 */
export type HomeItem = HomeItemBase & { options?: WidgetOptionValues } & (
    | { source: "builtin" }
    | { source: "panel"; panelId: string }
);

export interface HomeLayoutDoc {
    version: typeof HOME_LAYOUT_VERSION;
    items: HomeItem[];
}

export interface Placement {
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
    return { x: item.x, y: item.y, w, h };
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
            Number.isInteger(item.x) && Number.isInteger(item.y);
        const options = item ? parseWidgetOptionValues(item.options) : null;
        if (!ok || !options) {
            throw new Error(`Home layout item ${index} is malformed`);
        }
        const base = {
            id: item.id as string,
            computerId: item.computerId as string,
            widgetId: item.widgetId as string,
            size: item.size as string,
            x: item.x as number,
            y: item.y as number,
            ...(Object.keys(options).length > 0 ? { options } : {}),
        };
        return item.source === "builtin"
            ? { ...base, source: "builtin" as const }
            : { ...base, source: "panel" as const, panelId: item.panelId as string };
    });
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== items.length) throw new Error("Home layout repeats an item id");
    for (const item of items) {
        if (!inBounds(placementOf(item))) throw new Error(`Home layout item ${item.id} is off the grid`);
        // the rule every placement follows, so a stored layout can't break it either
        if (!canPlace(items, placementOf(item), item.id)) throw new Error(`Home layout item ${item.id} overlaps another widget`);
    }
    return items;
}

export function serializeHomeLayout(items: HomeItem[]): HomeLayoutDoc {
    return { version: HOME_LAYOUT_VERSION, items: items.map((item) => ({ ...item })) };
}

export function inBounds(p: Placement): boolean {
    return p.x >= 0 && p.x + p.w <= MAX_CELLS_ACROSS && p.y >= 0 && p.y + p.h <= MAX_ROWS;
}

function overlaps(a: Placement, b: Placement): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when `p` is on the grid and touches no item other than `ignoreId`. */
export function canPlace(items: HomeItem[], p: Placement, ignoreId?: string): boolean {
    if (!inBounds(p)) return false;
    return items.every((item) => item.id === ignoreId || !overlaps(p, placementOf(item)));
}

/** First free spot for a widget within `across` cells, row by row from the top. */
export function findFreeSpot(items: HomeItem[], size: WidgetSize, across: number): Placement | null {
    const width = Math.min(Math.max(across, size.w), MAX_CELLS_ACROSS);
    for (let y = 0; y + size.h <= MAX_ROWS; y++) {
        for (let x = 0; x + size.w <= width; x++) {
            const p = { x, y, ...size };
            if (canPlace(items, p)) return p;
        }
    }
    return null;
}

export interface HomeGeometry {
    /** px per cell */
    cell: number;
    /** cells drawn side by side: what the window fits, or the layout if it is wider */
    across: number;
}

/**
 * Cells flex between MIN_CELL and MAX_CELL before the window gains or loses
 * CELL_STEP of them, so a small resize changes cell size, not how many there
 * are. A window narrower than one step of MIN_CELL cells scales them down.
 * A layout wider than the window keeps its width; fitCanvas draws it smaller.
 */
export function computeGeometry(width: number, items: HomeItem[]): HomeGeometry {
    const available = Math.max(width, 0);
    const fit = Math.min(MAX_CELLS_ACROSS, Math.max(1, Math.floor(available / (CELL_STEP * MIN_CELL))) * CELL_STEP);
    const cell = Math.max(FLOOR_CELL, Math.min(MAX_CELL, available / fit));
    const used = items.reduce((max, item) => Math.max(max, item.x + sizeOf(item).w), 0);
    return { cell, across: Math.min(MAX_CELLS_ACROSS, Math.max(fit, used)) };
}

/**
 * How the canvas is drawn in `room` px of width: at full size when it fits,
 * otherwise smaller, down to MIN_CANVAS_SCALE, and centered in what's left.
 * Opening the gallery, or a window narrower than the layout, takes room from
 * Home without rearranging it. `width` is how much room the drawn canvas
 * takes; past the smallest scale it is wider than `room`, and Home scrolls
 * sideways to reach the rest.
 */
export const MIN_CANVAS_SCALE = 0.4;
export function fitCanvas(gridWidth: number, room: number): { scale: number; left: number; width: number } {
    const space = Math.max(room, 0);
    const scale = gridWidth > 0 ? Math.min(1, Math.max(MIN_CANVAS_SCALE, space / gridWidth)) : 1;
    const left = Math.max(0, (space - gridWidth * scale) / 2);
    return { scale, left, width: left + gridWidth * scale };
}

/** Rows the layout needs: its lowest widget, plus `extra`. */
export function usedRows(items: HomeItem[], extra: number): number {
    const rows = items.reduce((max, item) => Math.max(max, item.y + sizeOf(item).h), 1);
    return Math.min(MAX_ROWS, rows + extra);
}

/**
 * Snaps a widget whose top-left corner is at (left, top) px in grid space to
 * the nearest cell that keeps it on the grid. null when its center is off
 * the grid, so a widget dragged away from Home is not placed.
 */
export function snapToGrid(left: number, top: number, size: WidgetSize, geometry: HomeGeometry): Placement | null {
    const { cell, across } = geometry;
    const centerX = left + (size.w * cell) / 2;
    const centerY = top + (size.h * cell) / 2;
    if (centerX < 0 || centerX >= across * cell || centerY < 0) return null;
    const x = Math.min(across - size.w, Math.max(0, Math.round(left / cell)));
    const y = Math.max(0, Math.round(top / cell));
    return { x, y, ...size };
}

/** Keyboard move by one cell. */
export function stepPlacement(p: Placement, dx: number, dy: number): Placement {
    return { ...p, x: p.x + dx, y: p.y + dy };
}

// ── phones ───────────────────────────────────────────────────────────────
// A phone shows Home as pages, one column of PHONE_COLUMNS cells each,
// swiped sideways. It is its own document: a phone can't draw the
// window's layout, and arranging one must not rearrange the other. A
// page is a band of PHONE_COLUMNS cells, so item x = page * PHONE_COLUMNS
// + column, and the same item format and rules hold.

export const HOME_PHONE_LAYOUT_ID = "shell-home-phone-layout";
/** One column of the widest widget; the window grows by this many cells too. */
export const PHONE_COLUMNS = WIDGET_MAX_WIDTH;
export const MAX_PHONE_PAGES = Math.floor(MAX_CELLS_ACROSS / PHONE_COLUMNS);

export const pageOf = (p: Pick<Placement, "x">): number => Math.floor(p.x / PHONE_COLUMNS);

/** True when `p` sits inside one page: a widget never spans two. */
export function onOnePage(p: Placement): boolean {
    return (p.x % PHONE_COLUMNS) + p.w <= PHONE_COLUMNS;
}

/** canPlace, kept inside one page and above the page's bottom. */
export function canPlaceOnPhone(items: HomeItem[], p: Placement, rows: number, ignoreId?: string): boolean {
    return onOnePage(p) && p.y + p.h <= rows && canPlace(items, p, ignoreId);
}

/** Pages the layout fills: through its last page with a widget, at least one. */
export function usedPages(items: HomeItem[]): number {
    return items.reduce((max, item) => Math.max(max, pageOf(item) + 1), 1);
}

/** Reads the phone document: the same checks as the window's, and no widget across two pages. */
export function parsePhoneLayout(raw: unknown): HomeItem[] {
    const items = parseHomeLayout(raw);
    for (const item of items) {
        if (!onOnePage(placementOf(item))) throw new Error(`Home layout item ${item.id} spans two pages`);
    }
    return items;
}

/**
 * First free spot on a phone, row by row, from page `fromPage` on and then
 * the pages before it. null when every page is full.
 */
export function findPhoneSpot(items: HomeItem[], size: WidgetSize, rows: number, fromPage = 0): Placement | null {
    for (let n = 0; n < MAX_PHONE_PAGES; n++) {
        const page = (fromPage + n) % MAX_PHONE_PAGES;
        for (let y = 0; y + size.h <= rows; y++) {
            for (let col = 0; col + size.w <= PHONE_COLUMNS; col++) {
                const p = { x: page * PHONE_COLUMNS + col, y, ...size };
                if (canPlaceOnPhone(items, p, rows)) return p;
            }
        }
    }
    return null;
}

/**
 * A phone Home that was never arranged: the window's widgets in reading
 * order, filled into pages of `rows` rows. A widget that doesn't fit
 * anywhere, or belongs to a computer the phone doesn't show, is left off.
 */
export function phoneLayoutFrom(items: HomeItem[], rows: number, shown: ReadonlySet<string>): HomeItem[] {
    const placed: HomeItem[] = [];
    let page = 0;
    for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
        if (!shown.has(item.computerId)) continue;
        const spot = findPhoneSpot(placed, sizeOf(item), rows, page);
        if (!spot) continue;
        page = pageOf(spot);
        placed.push({ ...item, x: spot.x, y: spot.y });
    }
    return placed;
}

/** Drops empty pages, so the pages left keep their order without gaps. */
export function withoutEmptyPages(items: HomeItem[]): HomeItem[] {
    const pages = [...new Set(items.map((item) => pageOf(item)))].sort((a, b) => a - b);
    if (pages.every((page, index) => page === index)) return items;
    return items.map((item) => ({ ...item, x: pages.indexOf(pageOf(item)) * PHONE_COLUMNS + (item.x % PHONE_COLUMNS) }));
}

/**
 * Snaps a widget whose top-left corner is at (left, top) px to the page
 * its center is over. Pages are `pageWidth` px apart, their cells start
 * `gutter` px in. null when its center is off every page.
 */
export function snapToPhone(
    left: number,
    top: number,
    size: WidgetSize,
    phone: { cell: number; pageWidth: number; gutter: number; pages: number; rows: number },
): Placement | null {
    const { cell, pageWidth, gutter, pages, rows } = phone;
    const centerX = left + (size.w * cell) / 2;
    const centerY = top + (size.h * cell) / 2;
    if (centerX < 0 || centerX >= pages * pageWidth || centerY < 0) return null;
    const page = Math.floor(centerX / pageWidth);
    const col = Math.min(PHONE_COLUMNS - size.w, Math.max(0, Math.round((left - page * pageWidth - gutter) / cell)));
    const y = Math.min(Math.max(0, rows - size.h), Math.max(0, Math.round(top / cell)));
    return { x: page * PHONE_COLUMNS + col, y, ...size };
}
