import { describe, expect, test } from "bun:test";
import { HOME_LAYOUT_VERSION, parseHomeLayout, parsePhoneLayout, serializeHomeLayout, type HomeItem } from "../../src/renderer/src/lib/homeLayout";
import { defaultHomeItems } from "../../src/renderer/src/components/home/builtins/defaults";

const clock: HomeItem = { id: "clock-1", source: "builtin", computerId: "local", widgetId: "clock", size: "4x1", x: 0, y: 0 };
const pinned: HomeItem = {
    id: "pin-1", source: "panel", panelId: "dev.paperboard.terminal", computerId: "local",
    widgetId: "pinned-command", size: "2x1", x: 4, y: 0, options: { command: "uptime" },
};
const doc = (items: unknown[], version: unknown = HOME_LAYOUT_VERSION) => ({ version, items });

// Damaged Home layouts are refused, not replaced.
describe("Home layout", () => {
    test("a never-saved layout reads empty and saved widgets round-trip", () => {
        expect(parseHomeLayout(null)).toEqual([]);
        expect(parseHomeLayout(undefined)).toEqual([]);
        const saved = JSON.parse(JSON.stringify(serializeHomeLayout([clock, pinned])));
        expect(parseHomeLayout(saved)).toEqual([clock, pinned]);
    });

    test("an unknown version, malformed items, off-grid, repeated or overlapping widgets throw instead of reading as empty", () => {
        const damaged: Array<[string, unknown]> = [
            ["not an object", "layout"],
            ["an array", [clock]],
            ["an older version", doc([clock], 1)],
            ["a newer version", doc([clock], HOME_LAYOUT_VERSION + 1)],
            ["no items", { version: HOME_LAYOUT_VERSION }],
            ["an item with no id", doc([{ ...clock, id: undefined }])],
            ["an unknown source", doc([{ ...clock, source: "remote" }])],
            ["a panel widget with a bad panel id", doc([{ ...pinned, panelId: "../escape" }])],
            ["a bad size", doc([{ ...clock, size: "huge" }])],
            ["a fractional cell", doc([{ ...clock, x: 0.5 }])],
            ["off the grid", doc([{ ...clock, x: -1 }])],
            ["past the right edge", doc([{ ...clock, x: 31 }])],
            ["a repeated id", doc([clock, { ...pinned, id: clock.id }])],
            ["overlapping widgets", doc([clock, { ...pinned, x: 2 }])],
        ];
        for (const [, raw] of damaged) expect(() => parseHomeLayout(raw)).toThrow();
        expect(damaged).toHaveLength(14);
        // a phone layout also refuses a widget across two pages
        expect(() => parsePhoneLayout(doc([{ ...clock, x: 2 }]))).toThrow(/spans two pages/);
    });

    test("a new Home's default widgets form a valid layout", () => {
        const items = defaultHomeItems("local");
        expect(items.length).toBeGreaterThan(0);
        expect(parseHomeLayout(JSON.parse(JSON.stringify(serializeHomeLayout(items))))).toEqual(items);
    });
});
