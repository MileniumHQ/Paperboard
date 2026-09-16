import { describe, expect, test } from "bun:test";
import { getVariableInfo, parseVariableToken } from "../src/lib/variableTypes";

describe("parseVariableToken", () => {
    test("reads the id, label and icon the chip stores", () => {
        expect(parseVariableToken("{{enabled:Enabled:toggle_on}}")).toEqual({
            id: "enabled",
            label: "Enabled",
            icon: "toggle_on",
        });
    });

    test("literals and non-strings are not variables", () => {
        expect(parseVariableToken("true")).toBeNull();
        expect(parseVariableToken("")).toBeNull();
        expect(parseVariableToken(false)).toBeNull();
        expect(parseVariableToken(undefined)).toBeNull();
    });

    test("legacy tokens without a label or icon fall back", () => {
        expect(getVariableInfo("{{player}}")).toEqual({
            label: "Username",
            icon: "person_add",
        });
        expect(getVariableInfo("{{output}}")).toEqual({
            label: "Result",
            icon: "terminal",
        });
        expect(parseVariableToken("{{enabled}}")).toEqual({
            id: "enabled",
            label: "Enabled",
            icon: "bolt",
        });
    });
});
