// Widget declarations: the one rule the daemon's manifest validator and the
// packer share. A manifest that breaks it is refused, never trimmed.
import { describe, it, expect } from "bun:test";
import {
    MAX_WIDGETS_PER_PANEL,
    parseWidgetSize,
    validateWidgetDeclarations,
} from "../src/widgetManifest";
import { parseWidgetInitialize } from "../src/widget";

describe("validateWidgetDeclarations", () => {
    it("treats a missing field as no widgets", () => {
        expect(validateWidgetDeclarations(undefined)).toEqual([]);
    });

    it("keeps a valid declaration and drops unknown fields", () => {
        expect(
            validateWidgetDeclarations([
                { id: "status", name: " Server status ", sizes: ["2x1", "4x2"], description: "Up or down", entry: "../x" },
            ]),
        ).toEqual([{ id: "status", name: "Server status", sizes: ["2x1", "4x2"], description: "Up or down" }]);
    });

    const refused: [string, unknown][] = [
        ["not an array", { id: "a" }],
        ["a bad id", [{ id: "Status!", name: "S", sizes: ["1x1"] }]],
        ["a duplicate id", [{ id: "a", name: "A", sizes: ["1x1"] }, { id: "a", name: "B", sizes: ["1x1"] }]],
        ["a missing name", [{ id: "a", sizes: ["1x1"] }]],
        ["no sizes", [{ id: "a", name: "A", sizes: [] }]],
        ["a size wider than a column", [{ id: "a", name: "A", sizes: ["5x1"] }]],
        ["a malformed size", [{ id: "a", name: "A", sizes: ["2 x 1"] }]],
        ["a repeated size", [{ id: "a", name: "A", sizes: ["1x1", "1x1"] }]],
        ["a non-string description", [{ id: "a", name: "A", sizes: ["1x1"], description: 4 }]],
    ];
    for (const [label, raw] of refused) {
        it(`refuses ${label}`, () => {
            expect(() => validateWidgetDeclarations(raw)).toThrow();
        });
    }

    it("refuses more widgets than a panel may declare", () => {
        const many = Array.from({ length: MAX_WIDGETS_PER_PANEL + 1 }, (_, i) => ({ id: `w${i}`, name: "W", sizes: ["1x1"] }));
        expect(() => validateWidgetDeclarations(many)).toThrow(/at most/);
    });
});

describe("parseWidgetSize", () => {
    it("reads cells and refuses anything outside the grid", () => {
        expect(parseWidgetSize("2x3")).toEqual({ w: 2, h: 3 });
        expect(parseWidgetSize("0x1")).toBeNull();
        expect(parseWidgetSize("1x5")).toBeNull();
        expect(parseWidgetSize(21)).toBeNull();
    });
});

describe("parseWidgetInitialize", () => {
    it("accepts the shell's widget request", () => {
        expect(parseWidgetInitialize({ id: "status", instanceId: "abc-123", size: { w: 2, h: 1 }, visible: true }))
            .toEqual({ id: "status", instanceId: "abc-123", size: { w: 2, h: 1 }, visible: true });
    });

    it("refuses a malformed request instead of guessing a widget", () => {
        expect(parseWidgetInitialize({ id: "status", instanceId: "../x", size: { w: 2, h: 1 }, visible: true })).toBeNull();
        expect(parseWidgetInitialize({ id: "status", instanceId: "a", size: { w: 9, h: 1 }, visible: true })).toBeNull();
        expect(parseWidgetInitialize({ id: "status", instanceId: "a", size: { w: 1, h: 1 } })).toBeNull();
    });
});
