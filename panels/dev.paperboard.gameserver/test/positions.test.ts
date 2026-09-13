// Player position parsing (bun test): `data get entity <name> Pos` and
// `Dimension` replies must parse to typed values and must NOT be mistaken
// for stat or gamerule responses.
import { describe, test, expect } from "bun:test";
import {
    extractDimension,
    extractPosition,
    extractStatValue,
} from "../src/core/players";

describe("extractPosition", () => {
    test("parses a vector with trailing d/f suffixes", () => {
        expect(
            extractPosition("Steve has the following entity data: [123.5d, 64.0d, -45.25d]"),
        ).toEqual({ x: 123.5, y: 64, z: -45.25 });
        expect(
            extractPosition("Alex has the following entity data: [1.0f, 2.0f, 3.0f]"),
        ).toEqual({ x: 1, y: 2, z: 3 });
    });

    test("ignores non-vector lines (never steals a stat response)", () => {
        expect(extractPosition("Steve has the following entity data: 20")).toBeUndefined();
        expect(
            extractPosition('Steve has the following entity data: "minecraft:overworld"'),
        ).toBeUndefined();
    });
});

describe("extractDimension", () => {
    test("parses the quoted dimension id", () => {
        expect(
            extractDimension('Steve has the following entity data: "minecraft:the_nether"'),
        ).toBe("minecraft:the_nether");
    });

    test("ignores numeric and vector lines", () => {
        expect(extractDimension("Steve has the following entity data: 20")).toBeUndefined();
        expect(
            extractDimension("Steve has the following entity data: [1.0d, 2.0d, 3.0d]"),
        ).toBeUndefined();
    });
});

describe("extractStatValue handoff", () => {
    test("stat parser does not match vectors or dimensions", () => {
        expect(extractStatValue("[1.0d, 2.0d, 3.0d]")).toBeUndefined();
        expect(extractStatValue('"minecraft:overworld"')).toBeUndefined();
        expect(extractStatValue("has the following entity data: 20")).toBe(20);
    });
});
