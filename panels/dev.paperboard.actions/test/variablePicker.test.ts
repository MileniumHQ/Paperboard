import { describe, expect, test } from "bun:test";
import { filterPickerItems, isVarCompatibleWith } from "../src/lib/variablePicker";

describe("filterPickerItems", () => {
    const items = [
        { id: "message", type: "string" },
        { id: "count", type: "number" },
        { id: "sender", type: "discord-user" },
        { id: "flags", type: "list<number>" },
        { id: "anything" },
    ];

    test("a text field takes every variable", () => {
        // the picker used to close silently when this list came back empty;
        // primitives interpolate, so they must never filter
        expect(filterPickerItems(items, "string")).toHaveLength(items.length);
        expect(filterPickerItems(items)).toHaveLength(items.length);
        expect(filterPickerItems(items, "color")).toHaveLength(items.length);
    });

    test("a typed field only sees compatible variables", () => {
        // a list is not a scalar, it must not land in a number field
        expect(filterPickerItems(items, "number").map((i) => i.id)).toEqual([
            "count",
            "anything",
        ]);
        expect(filterPickerItems(items, "discord-user").map((i) => i.id)).toEqual([
            "sender",
            "anything",
        ]);
    });

    test("typed fields with no match return an empty list, not a closed menu", () => {
        expect(filterPickerItems([{ id: "count", type: "number" }], "discord-role")).toEqual([]);
    });

    test("string expectations accept discord types that render as text", () => {
        expect(isVarCompatibleWith("discord-channel", "string")).toBe(true);
        expect(isVarCompatibleWith("discord-channel", "list<string>")).toBe(true);
        expect(isVarCompatibleWith("number", "string")).toBe(false);
        expect(isVarCompatibleWith("string", "number")).toBe(false);
        expect(isVarCompatibleWith("number", "list<number>")).toBe(true);
    });
});
