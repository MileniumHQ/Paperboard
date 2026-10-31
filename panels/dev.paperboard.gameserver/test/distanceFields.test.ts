// Render and Simulation Distance are slider options on the shared Advanced
// tab. Their bounds are the slider's, and the shared validator every game's
// service uses refuses anything outside them.
import { describe, expect, test } from "bun:test";
import { minecraftOptions, fromProperty } from "../src/games/minecraft/options";
import { validateOptions } from "../src/games/options";

const option = (version: string, id: string) => {
    const found = minecraftOptions(version).find((f) => f.id === id);
    if (!found) throw new Error(`no ${id} option for ${version}`);
    return found;
};

describe("distance slider options", () => {
    test("render and simulation distance are 2-32 chunk sliders on Advanced, defaulting to vanilla's 10", () => {
        for (const id of ["view-distance", "simulation-distance"]) {
            expect(option("1.21.4", id)).toMatchObject({ kind: "slider", min: 2, max: 32, unit: "chunks", default: 10, tab: "advanced" });
        }
    });

    test("simulation distance is offered from 1.18, render distance always", () => {
        const distances = (version: string) => minecraftOptions(version).filter((f) => f.id.endsWith("-distance")).map((f) => f.id);
        expect(distances("1.17.1")).toEqual(["view-distance"]);
        expect(distances("1.18")).toEqual(["view-distance", "simulation-distance"]);
    });

    test("a slider takes whole numbers inside its bounds only", () => {
        const fields = minecraftOptions("1.21.4");
        for (const ok of [2, 10, 32]) expect(validateOptions(fields, "Minecraft", { "view-distance": ok })).toEqual({ "view-distance": ok });
        for (const bad of [1, 33, 10.5, "10", Number.NaN, Infinity, null]) {
            expect(() => validateOptions(fields, "Minecraft", { "view-distance": bad })).toThrow("Render Distance must be a whole number from 2 to 32");
        }
    });

    test("a stored value that is not a whole number is refused, never shown as the default", () => {
        expect(fromProperty(option("1.21.4", "view-distance"), "24")).toBe(24);
        expect(() => fromProperty(option("1.21.4", "view-distance"), "far")).toThrow("view-distance=far");
        expect(() => fromProperty(option("1.21.4", "pvp"), "yes")).toThrow("pvp=yes");
    });

    test("pre-1.14 servers store difficulty and game mode as numbers", () => {
        expect(option("1.12.2", "difficulty")).toMatchObject({ default: "1", choices: [{ value: "0", label: "Peaceful" }, { value: "1", label: "Easy" }, { value: "2", label: "Normal" }, { value: "3", label: "Hard" }] });
        expect(option("1.21.4", "gamemode")).toMatchObject({ default: "survival", restartRequired: false });
    });
});
