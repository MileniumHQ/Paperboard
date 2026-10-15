// Widget declarations: the one rule the daemon's manifest validator and the
// packer share. A manifest that breaks it is refused, never trimmed.
import { describe, it, expect } from "bun:test";
import {
    MAX_OPTIONS_PER_WIDGET,
    MAX_WIDGET_CHOICES,
    MAX_WIDGETS_PER_PANEL,
    parseWidgetChoices,
    parseWidgetOptionValues,
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
        ["options that are not a list", [{ id: "a", name: "A", sizes: ["1x1"], options: { id: "x" } }]],
        ["an option without a label", [{ id: "a", name: "A", sizes: ["1x1"], options: [{ id: "x" }] }]],
        ["a bad option id", [{ id: "a", name: "A", sizes: ["1x1"], options: [{ id: "X!", label: "X" }] }]],
        ["a repeated option", [{ id: "a", name: "A", sizes: ["1x1"], options: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] }]],
    ];
    for (const [label, raw] of refused) {
        it(`refuses ${label}`, () => {
            expect(() => validateWidgetDeclarations(raw)).toThrow();
        });
    }

    it("keeps declared options, trimmed", () => {
        expect(validateWidgetDeclarations([{ id: "run", name: "Run", sizes: ["1x1"], options: [{ id: "workflow", label: " Workflow " }] }]))
            .toEqual([{ id: "run", name: "Run", sizes: ["1x1"], options: [{ id: "workflow", label: "Workflow" }] }]);
        const many = Array.from({ length: MAX_OPTIONS_PER_WIDGET + 1 }, (_, i) => ({ id: `o${i}`, label: "O" }));
        expect(() => validateWidgetDeclarations([{ id: "run", name: "Run", sizes: ["1x1"], options: many }])).toThrow(/at most/);
    });

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

describe("parseWidgetChoices", () => {
    it("reads what a service offers", () => {
        expect(parseWidgetChoices([{ value: "backup", label: " Backup world " }])).toEqual([{ value: "backup", label: "Backup world" }]);
        expect(parseWidgetChoices([])).toEqual([]);
    });

    it("refuses a malformed or oversized list instead of showing part of it", () => {
        expect(() => parseWidgetChoices(undefined)).toThrow(/array/);
        expect(() => parseWidgetChoices([{ value: "", label: "A" }])).toThrow(/value/);
        expect(() => parseWidgetChoices([{ value: "a", label: "" }])).toThrow(/label/);
        expect(() => parseWidgetChoices([{ value: "a", label: "A" }, { value: "a", label: "B" }])).toThrow(/twice/);
        const many = Array.from({ length: MAX_WIDGET_CHOICES + 1 }, (_, i) => ({ value: `v${i}`, label: "V" }));
        expect(() => parseWidgetChoices(many)).toThrow(/at most/);
    });
});

describe("parseWidgetOptionValues", () => {
    it("reads a missing field as nothing chosen, and anything malformed as null", () => {
        expect(parseWidgetOptionValues(undefined)).toEqual({});
        expect(parseWidgetOptionValues({ step: "5" })).toEqual({ step: "5" });
        expect(parseWidgetOptionValues(null)).toBeNull();
        expect(parseWidgetOptionValues({ step: 5 })).toBeNull();
        expect(parseWidgetOptionValues({ "Bad!": "5" })).toBeNull();
        expect(parseWidgetOptionValues({ a: "1", b: "2", c: "3" })).toBeNull();
    });
});

describe("parseWidgetInitialize", () => {
    it("accepts the shell's widget request", () => {
        expect(parseWidgetInitialize({ id: "status", instanceId: "abc-123", size: { w: 2, h: 1 }, visible: true }))
            .toEqual({ id: "status", instanceId: "abc-123", size: { w: 2, h: 1 }, visible: true, options: {} });
        expect(parseWidgetInitialize({ id: "run", instanceId: "a", size: { w: 1, h: 1 }, visible: true, options: { workflow: "backup" } }))
            .toEqual({ id: "run", instanceId: "a", size: { w: 1, h: 1 }, visible: true, options: { workflow: "backup" } });
    });

    it("refuses a malformed request instead of guessing a widget", () => {
        expect(parseWidgetInitialize({ id: "status", instanceId: "../x", size: { w: 2, h: 1 }, visible: true })).toBeNull();
        expect(parseWidgetInitialize({ id: "status", instanceId: "a", size: { w: 9, h: 1 }, visible: true })).toBeNull();
        expect(parseWidgetInitialize({ id: "status", instanceId: "a", size: { w: 1, h: 1 } })).toBeNull();
        expect(parseWidgetInitialize({ id: "run", instanceId: "a", size: { w: 1, h: 1 }, visible: true, options: { workflow: 7 } })).toBeNull();
    });
});
