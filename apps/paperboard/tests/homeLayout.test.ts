// Home layout rules (bun test): widgets snap to a grid secretly cut into
// columns, never span two, never overlap, and a damaged layout is reported
// instead of read as empty.
import { describe, it, expect } from "bun:test";
import {
    bandRows,
    canPlace,
    columnOrigin,
    computeGeometry,
    findFreeSpot,
    fitCanvas,
    MAX_CELL,
    MIN_CELL,
    parseHomeLayout,
    serializeHomeLayout,
    snapToGrid,
    stepPlacement,
    type HomeItem,
} from "../src/renderer/src/lib/homeLayout";
import { createLoadQueue } from "../src/renderer/src/lib/loadQueue";

const item = (over: Partial<HomeItem>): HomeItem => ({
    id: "a", computerId: "local", source: "panel", panelId: "dev.paperboard.widgetdemo", widgetId: "clock",
    size: "2x1", column: 0, x: 0, y: 0, ...over,
} as HomeItem);

describe("parseHomeLayout", () => {
    it("reads a layout that was never saved as an empty Home", () => {
        expect(parseHomeLayout(null)).toEqual([]);
    });

    it("round-trips what it saves, panel and built-in widgets alike", () => {
        const builtin: HomeItem = { id: "c", computerId: "local", source: "builtin", widgetId: "memory", size: "2x2", column: 2, x: 0, y: 0 };
        const items = [item({}), item({ id: "b", column: 1, x: 2, y: 3, size: "2x2" }), builtin];
        expect(parseHomeLayout(JSON.parse(JSON.stringify(serializeHomeLayout(items))))).toEqual(items);
    });

    it("throws on a damaged layout instead of returning an empty one to overwrite", () => {
        expect(() => parseHomeLayout({ version: 99, items: [] })).toThrow(/version/);
        expect(() => parseHomeLayout({ version: 1, items: [{ id: "a" }] })).toThrow(/malformed/);
        // a panel widget names its panel; an unknown source is not guessed at
        expect(() => parseHomeLayout({ version: 1, items: [{ ...item({}), panelId: undefined }] })).toThrow(/malformed/);
        expect(() => parseHomeLayout({ version: 1, items: [{ ...item({}), source: "remote" }] })).toThrow(/malformed/);
        expect(() => parseHomeLayout({ version: 1, items: [item({ x: 3 })] })).toThrow(/off the grid/);
        expect(() => parseHomeLayout({ version: 1, items: [item({}), item({})] })).toThrow(/repeats/);
    });
});

describe("placement", () => {
    it("refuses overlap within a column but not across columns", () => {
        const items = [item({})];
        expect(canPlace(items, { column: 0, x: 1, y: 0, w: 2, h: 1 })).toBe(false);
        expect(canPlace(items, { column: 1, x: 0, y: 0, w: 2, h: 1 })).toBe(true);
        expect(canPlace(items, { column: 0, x: 1, y: 0, w: 2, h: 1 }, "a")).toBe(true);
    });

    it("never lets a widget hang over a column edge", () => {
        expect(canPlace([], { column: 0, x: 3, y: 0, w: 2, h: 1 })).toBe(false);
    });

    it("finds the first free spot column by column", () => {
        const items = [item({ size: "4x1" })];
        expect(findFreeSpot(items, { w: 2, h: 1 }, 2)).toEqual({ column: 0, x: 0, y: 1, w: 2, h: 1 });
    });
});

describe("geometry", () => {
    it("flexes cells before wrapping a column", () => {
        const wide = computeGeometry(4 * 4 * 110, []);
        expect(wide.fit).toBe(4);
        expect(wide.cell).toBe(110);
        const slightlyNarrower = computeGeometry(4 * 4 * 100, []);
        expect(slightlyNarrower.fit).toBe(4);
        expect(slightlyNarrower.cell).toBe(100);
        expect(computeGeometry(4 * 4 * 90, []).fit).toBe(3);
    });

    it("caps cell size on very wide windows", () => {
        expect(computeGeometry(6000, []).cell).toBe(MAX_CELL);
    });

    it("scales one column down instead of overflowing a tiny window", () => {
        const tiny = computeGeometry(300, []);
        expect(tiny.fit).toBe(1);
        expect(tiny.cell).toBe(75);
        expect(tiny.cell).toBeLessThan(MIN_CELL);
    });

    it("draws every column in use even when fewer fit", () => {
        expect(computeGeometry(4 * MIN_CELL, [item({ column: 2 })]).columns).toBe(3);
    });
});

describe("fitCanvas", () => {
    // editing Home opens the gallery over part of it: the canvas is drawn
    // smaller in the room that's left, and its layout is not recomputed
    it("draws the canvas at full size, centered, when it fits", () => {
        expect(fitCanvas(800, 1000)).toEqual({ scale: 1, left: 100 });
    });

    it("draws it smaller, from the left edge, when the room is narrower", () => {
        expect(fitCanvas(1200, 900)).toEqual({ scale: 0.75, left: 0 });
    });

    it("stops shrinking at a size that can still be read", () => {
        expect(fitCanvas(1200, 120)).toEqual({ scale: 0.4, left: 0 });
        expect(fitCanvas(1200, -50)).toEqual({ scale: 0.4, left: 0 });
    });

    it("has nothing to scale before Home is measured", () => {
        expect(fitCanvas(0, 0)).toEqual({ scale: 1, left: 0 });
    });
});

describe("wrapped columns", () => {
    // one column fits, three are in use: they stack and Home scrolls
    const items = [item({ column: 0, size: "2x2" }), item({ id: "b", column: 1 }), item({ id: "c", column: 2 })];
    const geometry = { fit: 1, cell: 100, columns: 3 };
    const rows = bandRows(items, geometry, 0);

    it("stacks columns that don't fit below each other", () => {
        expect(rows).toEqual([2, 1, 1]);
        expect(columnOrigin(1, geometry, rows)).toEqual({ left: 0, top: 200 });
        expect(columnOrigin(2, geometry, rows)).toEqual({ left: 0, top: 300 });
    });

    it("snaps a drop into the stacked column under it", () => {
        expect(snapToGrid(110, 205, { w: 2, h: 1 }, geometry, rows)).toEqual({ column: 1, x: 1, y: 0, w: 2, h: 1 });
    });
});

describe("snapToGrid", () => {
    const geometry = { fit: 2, cell: 100, columns: 2 };
    const rows = [4];

    it("puts a widget across a column edge in the column holding most of it", () => {
        // a 2-wide widget starting at x=3.4 cells: its center is in column 1
        expect(snapToGrid(340, 0, { w: 2, h: 1 }, geometry, rows)).toEqual({ column: 1, x: 0, y: 0, w: 2, h: 1 });
        // starting at x=2.4 cells: its center is still in column 0, clamped inside it
        expect(snapToGrid(240, 0, { w: 2, h: 1 }, geometry, rows)).toEqual({ column: 0, x: 2, y: 0, w: 2, h: 1 });
    });

    it("refuses a drop off the side of the grid", () => {
        expect(snapToGrid(-300, 0, { w: 2, h: 1 }, geometry, rows)).toBeNull();
        expect(snapToGrid(900, 0, { w: 2, h: 1 }, geometry, rows)).toBeNull();
    });
});

describe("stepPlacement", () => {
    it("moves into the neighboring column at its edge", () => {
        expect(stepPlacement({ column: 1, x: 0, y: 2, w: 2, h: 1 }, -1, 0)).toEqual({ column: 0, x: 2, y: 2, w: 2, h: 1 });
        expect(stepPlacement({ column: 0, x: 2, y: 2, w: 2, h: 1 }, 1, 0)).toEqual({ column: 1, x: 0, y: 2, w: 2, h: 1 });
    });
});

describe("load queue", () => {
    it("grants at most the limit and hands a released slot to the next waiter", async () => {
        const queue = createLoadQueue(2);
        const order: number[] = [];
        const slots = [0, 1, 2].map((i) => {
            const slot = queue.acquire();
            void slot.granted.then(() => order.push(i));
            return slot;
        });
        await Promise.resolve();
        expect(order).toEqual([0, 1]);
        expect(queue.waiting).toBe(1);
        slots[0].release();
        slots[0].release();
        await Promise.resolve();
        expect(order).toEqual([0, 1, 2]);
        expect(queue.active).toBe(2);
    });

    it("drops a waiter that gives up without spending a slot", async () => {
        const queue = createLoadQueue(1);
        const first = queue.acquire();
        const gaveUp = queue.acquire();
        const third = queue.acquire();
        let thirdGranted = false;
        void third.granted.then(() => { thirdGranted = true; });
        gaveUp.release();
        first.release();
        await Promise.resolve();
        expect(thirdGranted).toBe(true);
        expect(queue.active).toBe(1);
        expect(queue.waiting).toBe(0);
    });
});
