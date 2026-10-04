import { expect, test } from "bun:test";
import { expectedTypeOf, isArrayInputType, isTypedOnlyInput } from "../src/lib/inputTypes";

test("Discord input pills require typed variables for references and component lists", () => {
    for (const type of ["discord-user", "discord-channel", "discord-message", "discord-interaction", "list<discord-embed>", "list<discord-component>"]) {
        expect(isTypedOnlyInput({ type })).toBe(true);
    }
    for (const type of ["string", "number", "boolean", "object", "any", "url", "color", "array", "list<string>"]) {
        expect(isTypedOnlyInput({ type })).toBe(false);
    }
    expect(isTypedOnlyInput({ type: "discord-user", options: [{ label: "Selected user", value: "123" }] })).toBe(false);
});

test("a list pill requests its element type from the variable picker", () => {
    expect(expectedTypeOf({ type: "list<discord-component>" })).toBe("discord-component");
    expect(expectedTypeOf({ type: "array" })).toBe("any");
    expect(expectedTypeOf({ type: "discord-user" })).toBe("discord-user");
    expect(isArrayInputType("list<discord-embed>")).toBe(true);
    expect(isArrayInputType("discord-user")).toBe(false);
});
