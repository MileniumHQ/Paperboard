// World manager decisions (bun test): activation planning, creation-name
// validation, and info merging are pure core — the service owns IO and the
// offline guard, the component only renders. A wrong plan here boots the
// wrong world or forks "World" vs "world" into two generations.
import { describe, test, expect } from "bun:test";
import {
    assertCreatableWorldName,
    buildWorldInfos,
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

    test("a configured world that never generated still appears", () => {
        const infos = buildWorldInfos([{ name: "alpha", generated: true }], "brand_new");
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
