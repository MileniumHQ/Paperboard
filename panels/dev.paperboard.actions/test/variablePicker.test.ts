import { describe, expect, test } from "bun:test";
import { filterPickerItems, isVarCompatibleWith } from "../src/lib/variablePicker";
import { updateTypeCatalog } from "../src/lib/typeCatalog";

// the types a panel registers with its actions; nothing about them is built in
updateTypeCatalog([
    {
        types: {
            "discord-user": { id: "discord-user", name: "User", base: "string" },
            "discord-channel": { id: "discord-channel", name: "Channel", base: "string" },
            "discord-embed": { id: "discord-embed", name: "Embed", base: "object" },
        },
    },
]);

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

    test("text expectations accept panel types built on text, not on data", () => {
        expect(isVarCompatibleWith("discord-channel", "string")).toBe(true);
        expect(isVarCompatibleWith("discord-channel", "list<string>")).toBe(true);
        expect(isVarCompatibleWith("discord-embed", "list<string>")).toBe(false);
        // an unregistered type is not assumed to be text from its name
        expect(isVarCompatibleWith("discord-mystery", "list<string>")).toBe(false);
        expect(isVarCompatibleWith("number", "string")).toBe(false);
        expect(isVarCompatibleWith("string", "number")).toBe(false);
        expect(isVarCompatibleWith("number", "list<number>")).toBe(true);
    });
});
