// World manager decisions (bun test): activation planning, creation-name
// validation, and info merging are pure core — the service owns IO and the
// offline guard, the component only renders. A wrong plan here boots the
// wrong world or forks "World" vs "world" into two generations.
import { describe, test, expect } from "bun:test";
import {
    assertCreatableWorldName,
    buildWorldInfos,
    isWorldNameTaken,
    planWorldActivation,
} from "../src/core/worlds";

describe("assertCreatableWorldName", () => {
    test("accepts plain names", () => {
        expect(assertCreatableWorldName("world")).toBe("world");
        expect(assertCreatableWorldName("  survival_2 ")).toBe("survival_2");
    });

    test("refuses shell-adjacent and empty names", () => {
        for (const bad of ["", "  ", "my world", "../evil", "a/b", "a\\b", "-lead", ".dot", "semi;colon", "quote'"]) {
            expect(() => assertCreatableWorldName(bad)).toThrow(/Refusing/);
        }
    });
});

describe("planWorldActivation", () => {
    test("active world is a noop", () => {
        expect(planWorldActivation("world", ["world", "creative"], "world")).toEqual({
            kind: "noop-active",
            name: "world",
        });
    });

    test("existing directory switches, preserving stored case", () => {
        expect(planWorldActivation("CREATIVE", ["world", "Creative"], "world")).toEqual({
            kind: "switch",
            name: "Creative",
        });
    });

    test("unknown name creates after strict validation", () => {
        expect(planWorldActivation("fresh_start-2", ["world"], "world")).toEqual({
            kind: "create",
            name: "fresh_start-2",
        });
        expect(() => planWorldActivation("has space", ["world"], "world")).toThrow(/Refusing/);
    });

    test("the configured world with no directory is a create", () => {
        expect(planWorldActivation("World", ["creative"], "world")).toEqual({
            kind: "create",
            name: "World",
        });
    });

    test("empty request refuses instead of booting a default", () => {
        expect(() => planWorldActivation("  ", ["world"], "world")).toThrow(/required/);
    });
});

describe("buildWorldInfos", () => {
    test("active sorts first, rest alphabetical", () => {
        const infos = buildWorldInfos(
            [
                { name: "zeta", generated: true },
                { name: "world", generated: true },
                { name: "alpha", generated: true },
            ],
            "world",
        );
        expect(infos.map((i) => i.name)).toEqual(["world", "alpha", "zeta"]);
        expect(infos[0].active).toBe(true);
        expect(infos[1].active).toBe(false);
    });

    test("matching is case-insensitive", () => {
        const infos = buildWorldInfos([{ name: "World", generated: true }], "world");
        expect(infos[0].active).toBe(true);
    });

    // the level-name alone names no world: a deleted active world must not
    // come back as a placeholder card (created worlds arrive as candidates)
    test("a level-name with no candidate adds no card", () => {
        const infos = buildWorldInfos([{ name: "alpha", generated: true }], "deleted_one");
        expect(infos.map((i) => i.name)).toEqual(["alpha"]);
        expect(infos[0].active).toBe(false);
    });

    test("a created world that never generated still appears", () => {
        const infos = buildWorldInfos(
            [
                { name: "alpha", generated: true },
                { name: "brand_new", generated: false },
            ],
            "brand_new",
        );
        expect(infos.map((i) => i.name)).toEqual(["brand_new", "alpha"]);
        expect(infos[0]).toMatchObject({ active: true, generated: false });
    });

    test("generated flag propagates from the candidate", () => {
        const infos = buildWorldInfos(
            [{ name: "world", generated: false }],
            "other",
        );
        expect(infos[0].generated).toBe(false);
    });
});

describe("isWorldNameTaken", () => {
    test("matches case-insensitively after trimming", () => {
        expect(isWorldNameTaken(["world", "creative"], "World")).toBe(true);
        expect(isWorldNameTaken(["world"], "  WORLD  ")).toBe(true);
        expect(isWorldNameTaken(["world"], "survival")).toBe(false);
    });

    test("an empty proposal never counts as taken", () => {
        expect(isWorldNameTaken(["world"], "")).toBe(false);
        expect(isWorldNameTaken(["world"], "   ")).toBe(false);
    });
});
