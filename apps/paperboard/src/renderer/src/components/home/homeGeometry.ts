import { type Accessor, createMemo } from "solid-js";
import { WIDGET_MAX_HEIGHT } from "@mileniumhq/paperapi";
import {
    canPlace,
    canPlaceOnPhone,
    computeGeometry,
    fitBesideGallery,
    fitCanvas,
    FLOOR_CELL,
    MAX_PHONE_PAGES,
    pageOf,
    PHONE_COLUMNS,
    usedColumns,
    usedPages,
    usedRows,
    type HomeItem,
    type Placement,
} from "../../lib/homeLayout";

// empty columns kept in view beside the widgets while the gallery is open
const GALLERY_SPARE_COLUMNS = 2;

export interface HomeGeometryOptions {
    phone: Accessor<boolean>;
    items: Accessor<HomeItem[]>;
    /** Home's room inside its scroller's padding, as last measured on screen */
    viewport: Accessor<{ width: number; height: number }>;
    /** the room between a phone page's cells and the screen's sides */
    gutter: Accessor<number>;
    editing: Accessor<boolean>;
    /** a widget is carried: a phone has one more, empty page to carry it to */
    dragging: Accessor<boolean>;
    galleryOpen: Accessor<boolean>;
    /** the room the open gallery takes from Home's right edge */
    galleryWidth: Accessor<number>;
}

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

// Where Home's cells are and how big. The layout never changes to fit: when
// it is wider than the window, or the gallery takes room from it, it is
// drawn smaller. A phone draws pages side by side, each the screen's width
// with PHONE_COLUMNS cells inside it, as many rows as fit the screen.
export function createHomeGeometry(options: HomeGeometryOptions) {
    const { phone, items, viewport, gutter, editing } = options;
    const phoneCell = createMemo(() => Math.max(FLOOR_CELL, (viewport().width - gutter() * 2) / PHONE_COLUMNS));
    const phoneRows = createMemo(() => Math.max(WIDGET_MAX_HEIGHT, Math.floor(viewport().height / phoneCell())));
    const pages = createMemo(() => Math.min(MAX_PHONE_PAGES, usedPages(items()) + (options.dragging() ? 1 : 0)));
    const pageWidth = () => viewport().width;
    const phoneGeometry = () => ({ cell: phoneCell(), pageWidth: pageWidth(), gutter: gutter(), pages: pages(), rows: phoneRows() });

    const geometry = createMemo(() =>
        phone() ? { cell: phoneCell(), across: pages() * PHONE_COLUMNS } : computeGeometry(viewport().width, items()),
    );
    const gridWidth = () => (phone() ? pages() * pageWidth() : geometry().across * geometry().cell);
    // The gallery floats over Home's right edge. Home keeps its size while
    // its widgets, and a spare column pair to drop beside them, clear it.
    const keptWidth = () => Math.min(geometry().across, usedColumns(items()) + GALLERY_SPARE_COLUMNS) * geometry().cell;
    const fitted = createMemo(() =>
        phone()
            ? { scale: 1, left: 0, width: gridWidth() }
            : options.galleryOpen()
              ? fitBesideGallery(gridWidth(), keptWidth(), viewport().width, viewport().width - options.galleryWidth())
              : fitCanvas(gridWidth(), viewport().width),
    );
    const scale = () => fitted().scale;
    const gridLeft = () => fitted().left;
    // columns not under the gallery, where an added widget can be seen landing
    const visibleAcross = () =>
        options.galleryOpen() && !phone()
            ? Math.max(1, Math.floor((viewport().width - options.galleryWidth() - gridLeft()) / (geometry().cell * scale())))
            : geometry().across;
    // a spare row to drop into while editing; never fewer than reach the
    // bottom of the window, so the dots do too
    const rows = createMemo(() =>
        phone()
            ? Math.max(phoneRows(), usedRows(items(), 0))
            : Math.max(usedRows(items(), editing() ? 1 : 0), Math.floor(viewport().height / (geometry().cell * scale()))),
    );
    const gridHeight = () => rows() * geometry().cell;
    const inset = () => Math.round(geometry().cell * 0.06);
    const fits = (p: Placement, ignoreId?: string) =>
        phone() ? canPlaceOnPhone(items(), p, phoneRows(), ignoreId) : canPlace(items(), p, ignoreId);

    const rectOf = (p: Placement): Rect => {
        const g = geometry();
        // on a phone, x counts across pages: which page, then which column in it
        const left = phone() ? pageOf(p) * pageWidth() + gutter() + (p.x % PHONE_COLUMNS) * g.cell : p.x * g.cell;
        return {
            left: left + inset(),
            top: p.y * g.cell + inset(),
            width: p.w * g.cell - inset() * 2,
            height: p.h * g.cell - inset() * 2,
        };
    };

    return { phoneRows, pages, pageWidth, phoneGeometry, geometry, gridWidth, fitted, scale, gridLeft, visibleAcross, gridHeight, inset, fits, rectOf };
}

/** a rect as the style that places it */
export const px = (r: Rect) => ({
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
});
