// Panel-defined types are named and drawn from the registry, never from a
// list built into Actions (bun test).
import { describe, expect, test } from "bun:test";
import {
    collectTypeCatalog,
    typeDisplayName,
    typeIcon,
    updateTypeCatalog,
} from "../src/lib/typeCatalog";
import { variableFieldIcon } from "../src/lib/variableTypes";

describe("type catalog", () => {
    test("names and icons come from the types registered schemas carry", () => {
        updateTypeCatalog([
            { types: { "game-player": { id: "game-player", name: "Player", icon: "person", base: "string" } } },
        ]);
        expect(typeDisplayName("game-player")).toBe("Player");
        expect(typeDisplayName("list<game-player>")).toBe("Player[]");
        expect(typeIcon("game-player")).toBe("person");
        expect(variableFieldIcon("game-player")).toBe("person");
        // a field's own icon still wins
        expect(variableFieldIcon("game-player", "star")).toBe("star");
    });

    test("primitives use Actions' own words; unknown types fall back plainly", () => {
        updateTypeCatalog([]);
        expect(typeDisplayName("string")).toBe("Text");
        expect(typeDisplayName("game-player")).toBe("Game-player");
        expect(variableFieldIcon("game-player")).toBe("bolt");
    });

    test("a type that leaves the registry leaves the catalog", () => {
        updateTypeCatalog([{ types: { t: { id: "t", name: "Ticket", base: "string" } } }]);
        expect(typeDisplayName("t")).toBe("Ticket");
        updateTypeCatalog([]);
        expect(typeDisplayName("t")).toBe("T");
        expect(typeIcon("t")).toBeUndefined();
    });

    test("the first panel to register a type id keeps it", () => {
        const catalog = collectTypeCatalog([
            { types: { shared: { id: "shared", name: "First", base: "string" } } },
            { types: { shared: { id: "shared", name: "Second", base: "object" } } },
        ]);
        expect(catalog.get("shared")?.name).toBe("First");
    });
});
