// Panel category resolution (bun test): a panel declares its categories
// once (icon + order) and each action/trigger only names one; the declared
// metadata must win over the bare name.
import { describe, it, expect } from "bun:test";
import { resolveItemCategory } from "../src/service";

describe("resolveItemCategory", () => {
    it("resolves a named category to its declared metadata", () => {
        expect(
            resolveItemCategory("Messages", [
                { name: "Messages", icon: "chat", order: 1 },
            ]),
        ).toEqual({ name: "Messages", icon: "chat", order: 1 });
    });

    it("leaves unknown names and explicit objects untouched", () => {
        expect(resolveItemCategory("Other", [{ name: "Messages" }])).toBe("Other");
        const explicit = { name: "Custom", icon: "star" };
        expect(resolveItemCategory(explicit, [{ name: "Messages" }])).toBe(explicit);
        expect(resolveItemCategory(undefined, [{ name: "Messages" }])).toBeUndefined();
        expect(resolveItemCategory("Messages", [])).toBe("Messages");
    });
});
