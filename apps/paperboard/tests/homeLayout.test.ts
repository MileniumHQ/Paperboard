// Home layout rules (bun test): widgets snap anywhere on one grid, never
// overlap, a layout wider than the window keeps its shape, and a damaged
// layout is reported instead of read as empty.
import { describe, it, expect } from "bun:test";
import {
    canPlace,
    computeGeometry,
    findFreeSpot,
    fitCanvas,
    MAX_CELL,
    MAX_CELLS_ACROSS,
    MIN_CELL,
    parseHomeLayout,
    serializeHomeLayout,
    snapToGrid,
    stepPlacement,
    usedRows,
    type HomeItem,
} from "../src/renderer/src/lib/homeLayout";
import { createLoadQueue } from "../src/renderer/src/lib/loadQueue";

const item = (over: Partial<HomeItem>): HomeItem => ({
    id: "a", computerId: "local", source: "panel", panelId: "dev.paperboard.widgetdemo", widgetId: "clock",
    size: "2x1", x: 0, y: 0, ...over,
} as HomeItem);

describe("parseHomeLayout", () => {
    it("reads a layout that was never saved as an empty Home", () => {
        expect(parseHomeLayout(null)).toEqual([]);
    });

    it("round-trips what it saves, panel and built-in widgets alike", () => {
        const builtin: HomeItem = { id: "c", computerId: "local", source: "builtin", widgetId: "memory", size: "2x2", x: 9, y: 0 };
        const items = [item({}), item({ id: "b", x: 3, y: 3, size: "2x2" }), builtin];
        expect(parseHomeLayout(JSON.parse(JSON.stringify(serializeHomeLayout(items))))).toEqual(items);
    });

    it("keeps what was chosen for a panel widget, and only for one", () => {
        const chosen = item({ widgetId: "counter", size: "1x1", options: { step: "5" } } as Partial<HomeItem>);
        expect(parseHomeLayout(JSON.parse(JSON.stringify(serializeHomeLayout([chosen]))))).toEqual([chosen]);
        expect(() => parseHomeLayout({ version: 2, items: [{ ...item({}), options: { step: 5 } }] })).toThrow(/malformed/);
        const builtin = { id: "c", computerId: "local", source: "builtin", widgetId: "memory", size: "2x2", x: 0, y: 0 };
        expect(() => parseHomeLayout({ version: 2, items: [{ ...builtin, options: { step: "5" } }] })).toThrow(/malformed/);
    });

    it("throws on a damaged layout instead of returning an empty one to overwrite", () => {
        expect(() => parseHomeLayout({ version: 99, items: [] })).toThrow(/version/);
        expect(() => parseHomeLayout({ version: 2, items: [{ id: "a" }] })).toThrow(/malformed/);
        // a panel widget names its panel; an unknown source is not guessed at
        expect(() => parseHomeLayout({ version: 2, items: [{ ...item({}), panelId: undefined }] })).toThrow(/malformed/);
        expect(() => parseHomeLayout({ version: 2, items: [{ ...item({}), source: "remote" }] })).toThrow(/malformed/);
        expect(() => parseHomeLayout({ version: 2, items: [item({ x: MAX_CELLS_ACROSS - 1 })] })).toThrow(/off the grid/);
        expect(() => parseHomeLayout({ version: 2, items: [item({}), item({})] })).toThrow(/repeats/);
        expect(() => parseHomeLayout({ version: 2, items: [item({}), item({ id: "b", x: 1 })] })).toThrow(/overlaps/);
    });

    it("refuses the unreleased column format (version 1) instead of guessing at it", () => {
        expect(() => parseHomeLayout({ version: 1, items: [{ ...item({ x: 2, y: 1 }), column: 2 }] })).toThrow(/version 1 is not one/);
    });
});

describe("placement", () => {
    it("refuses overlap and nothing else: any free cells will do", () => {
        const items = [item({})];
        expect(canPlace(items, { x: 1, y: 0, w: 2, h: 1 })).toBe(false);
        expect(canPlace(items, { x: 2, y: 0, w: 2, h: 1 })).toBe(true);
        // across what used to be a column edge
        expect(canPlace(items, { x: 3, y: 0, w: 2, h: 1 })).toBe(true);
        expect(canPlace(items, { x: 1, y: 0, w: 2, h: 1 }, "a")).toBe(true);
    });

    it("never lets a widget hang off the grid", () => {
        expect(canPlace([], { x: -1, y: 0, w: 2, h: 1 })).toBe(false);
        expect(canPlace([], { x: MAX_CELLS_ACROSS - 1, y: 0, w: 2, h: 1 })).toBe(false);
    });

    it("finds the first free spot row by row, within the cells on screen", () => {
        const items = [item({ size: "4x1" })];
        expect(findFreeSpot(items, { w: 2, h: 1 }, 8)).toEqual({ x: 4, y: 0, w: 2, h: 1 });
        expect(findFreeSpot(items, { w: 2, h: 1 }, 4)).toEqual({ x: 0, y: 1, w: 2, h: 1 });
    });
});

describe("geometry", () => {
    it("flexes cells before the window gains or loses any", () => {
        const wide = computeGeometry(4 * 4 * 110, []);
        expect(wide.across).toBe(16);
        expect(wide.cell).toBe(110);
        const slightlyNarrower = computeGeometry(4 * 4 * 100, []);
        expect(slightlyNarrower.across).toBe(16);
        expect(slightlyNarrower.cell).toBe(100);
        expect(computeGeometry(4 * 4 * 90, []).across).toBe(12);
    });

    it("caps cell size on very wide windows", () => {
        expect(computeGeometry(6000, []).cell).toBe(MAX_CELL);
    });

    it("scales cells down instead of overflowing a tiny window", () => {
        const tiny = computeGeometry(300, []);
        expect(tiny.across).toBe(4);
        expect(tiny.cell).toBe(75);
        expect(tiny.cell).toBeLessThan(MIN_CELL);
    });

    it("keeps a layout wider than the window as it is, to be drawn smaller", () => {
        const g = computeGeometry(4 * MIN_CELL, [item({ x: 6 })]);
        expect(g).toEqual({ cell: MIN_CELL, across: 8 });
        expect(fitCanvas(g.across * g.cell, 4 * MIN_CELL).scale).toBe(0.5);
    });

    it("needs as many rows as its lowest widget, and a spare one while editing", () => {
        expect(usedRows([], 0)).toBe(1);
        expect(usedRows([item({ y: 2, size: "2x2" })], 0)).toBe(4);
        expect(usedRows([item({ y: 2, size: "2x2" })], 1)).toBe(5);
    });
});

describe("fitCanvas", () => {
    // editing Home opens the gallery over part of it: the canvas is drawn
    // smaller in the room that's left, and its layout is not recomputed
    it("draws the canvas at full size, centered, when it fits", () => {
        expect(fitCanvas(800, 1000)).toEqual({ scale: 1, left: 100, width: 900 });
    });

    it("draws it smaller, from the left edge, when the room is narrower", () => {
        expect(fitCanvas(1200, 900)).toEqual({ scale: 0.75, left: 0, width: 900 });
    });

    it("stops shrinking at a size that can still be read, and is then wider than the room", () => {
        // 480 px drawn in 120 px of room: Home scrolls sideways to reach the rest
        expect(fitCanvas(1200, 120)).toEqual({ scale: 0.4, left: 0, width: 480 });
        expect(fitCanvas(1200, -50)).toEqual({ scale: 0.4, left: 0, width: 480 });
    });

    it("has nothing to scale before Home is measured", () => {
        expect(fitCanvas(0, 0)).toEqual({ scale: 1, left: 0, width: 0 });
    });
});

describe("snapToGrid", () => {
    const geometry = { cell: 100, across: 8 };

    it("snaps to the nearest cell, wherever that is", () => {
        // a 2-wide widget starting at x=3.4 cells sits on cells 3 and 4
        expect(snapToGrid(340, 0, { w: 2, h: 1 }, geometry)).toEqual({ x: 3, y: 0, w: 2, h: 1 });
        expect(snapToGrid(260, 140, { w: 2, h: 1 }, geometry)).toEqual({ x: 3, y: 1, w: 2, h: 1 });
    });

    it("keeps a widget dropped over an edge on the grid", () => {
        expect(snapToGrid(-60, 0, { w: 2, h: 1 }, geometry)).toEqual({ x: 0, y: 0, w: 2, h: 1 });
        expect(snapToGrid(680, 0, { w: 2, h: 1 }, geometry)).toEqual({ x: 6, y: 0, w: 2, h: 1 });
    });

    it("refuses a drop off the side of the grid", () => {
        expect(snapToGrid(-300, 0, { w: 2, h: 1 }, geometry)).toBeNull();
        expect(snapToGrid(900, 0, { w: 2, h: 1 }, geometry)).toBeNull();
    });
});

describe("stepPlacement", () => {
    it("moves one cell at a time, with no edge to cross", () => {
        expect(stepPlacement({ x: 4, y: 2, w: 2, h: 1 }, -1, 0)).toEqual({ x: 3, y: 2, w: 2, h: 1 });
        expect(stepPlacement({ x: 3, y: 2, w: 2, h: 1 }, 0, 1)).toEqual({ x: 3, y: 3, w: 2, h: 1 });
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
