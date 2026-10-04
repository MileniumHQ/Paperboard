import { describe, expect, test } from "bun:test";
import {
    hullFromAlpha,
    worldHull,
    contactBetween,
    containsPoint,
} from "../public/js/icon-geometry.mjs";

const alpha = (min: number, max: number) => {
    const pixels = new Uint8ClampedArray(8 * 8 * 4);
    for (let y = min; y < max; y++)
        for (let x = min; x < max; x++) pixels[(y * 8 + x) * 4 + 3] = 255;
    return hullFromAlpha(pixels, 8, 8, 80);
};
const placed = (hull: { x: number; y: number }[], x: number, y = 0, angle = 0) =>
    worldHull({ hull, x, y, size: 80, angle });

describe("visible icon collision shapes", () => {
    test("transparent padding does not bump or grab another icon", () => {
        const hull = alpha(2, 6);
        expect(contactBetween(placed(hull, 0), placed(hull, 45))).toBeNull();
        expect(containsPoint(hull, -35, -35)).toBe(false);
        expect(containsPoint(hull, 0, 0)).toBe(true);
    });
    test("visible square edges collide beyond the old circle radius", () => {
        const hull = alpha(0, 8);
        expect(contactBetween(placed(hull, 0), placed(hull, 76))?.overlap).toBe(4);
    });
    test("the same silhouette follows its rendered rotation", () => {
        const hull = alpha(2, 6);
        expect(contactBetween(placed(hull, 0), placed(hull, 43))).toBeNull();
        expect(contactBetween(placed(hull, 0, 0, Math.PI / 4), placed(hull, 43))).not.toBeNull();
    });
    test("contained shapes separate all the way, not by their intersection width", () => {
        const outer = [
            { x: -50, y: -50 },
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            { x: -50, y: 50 },
        ];
        const inner = [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
        ];
        expect(contactBetween(outer, inner)?.overlap).toBe(60);
    });
    test("faint shadows stay outside the hitbox and invisible assets fail", () => {
        const pixels = new Uint8ClampedArray(8 * 8 * 4).fill(32);
        expect(() => hullFromAlpha(pixels, 8, 8, 80)).toThrow("no visible");
    });
});
