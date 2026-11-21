import { describe, expect, test } from "bun:test";
import { parsePackageRecipe, recipeDigest } from "../src";

describe("package recipes", () => {
    test("file unpack accepts a single take from file into bin/ and rejects other forms", () => {
        const recipe = parsePackageRecipe({ unpack: "file", take: { "bin/agy.exe": "file" } });
        expect(recipe).toEqual({ unpack: "file", take: { "bin/agy.exe": "file" } });
        expect(recipeDigest(recipe)).toMatch(/^[a-f0-9]{64}$/);

        expect(() => parsePackageRecipe({ unpack: "file", take: { "bin/agy.exe": "other" } })).toThrow(/from "file"/);
        expect(() =>
            parsePackageRecipe({ unpack: "file", take: { "bin/agy.exe": "file", "bin/other": "file" } }),
        ).toThrow(/exactly one path/);
        expect(() => parsePackageRecipe({ unpack: "file", take: { "lib/agy.exe": "file" } })).toThrow(/bin\//);
    });
});
