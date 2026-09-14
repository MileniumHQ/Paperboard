import { describe, expect, test } from "bun:test";
import { runtimeCommandsFor } from "../src/service/runtimeProperties";

describe("runtimeCommandsFor", () => {
    test("difficulty maps to the difficulty command", () => {
        expect(runtimeCommandsFor({ difficulty: "hard" })).toEqual(["difficulty hard"]);
    });

    test("gamemode maps to defaultgamemode", () => {
        expect(runtimeCommandsFor({ gamemode: "creative" })).toEqual([
            "defaultgamemode creative",
        ]);
    });

    test("force-gamemode also forces online players", () => {
        expect(runtimeCommandsFor({ gamemode: "creative", "force-gamemode": "true" })).toEqual([
            "defaultgamemode creative",
            "gamemode creative @a",
        ]);
    });

    test("legacy integers map to the same commands", () => {
        expect(runtimeCommandsFor({ difficulty: "1" })).toEqual(["difficulty easy"]);
        expect(runtimeCommandsFor({ gamemode: "0" })).toEqual([
            "defaultgamemode survival",
        ]);
        expect(
            runtimeCommandsFor({ gamemode: "1", "force-gamemode": "true" }),
        ).toEqual(["defaultgamemode creative", "gamemode creative @a"]);
    });

    test("unknown values are ignored, not injected", () => {
        expect(runtimeCommandsFor({ difficulty: "hardcore", gamemode: "god" })).toEqual([]);
        expect(runtimeCommandsFor({})).toEqual([]);
    });

    test("force-gamemode alone issues no command (applies on next start)", () => {
        expect(runtimeCommandsFor({ "force-gamemode": "true" })).toEqual([]);
    });
});
