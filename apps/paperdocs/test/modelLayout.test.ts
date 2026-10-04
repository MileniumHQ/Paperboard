import { expect, test } from "bun:test";
import { layoutModels } from "../public/js/model-layout.mjs";

const items = [
    { radius: 3.6, height: 4.16, minY: -0.001, scale: 0.36 },
    { radius: 3.2, height: 2.43, minY: 0, scale: 0.4 },
    { radius: 2.8, height: 0.96, minY: 0, scale: 0.28 },
    { radius: 2.7, height: 0.75, minY: 0.005, scale: 0.24 },
    { radius: 4.5, height: 4.85, minY: 0, scale: 0.36 },
];

test("all models fit and remain separated across portrait, square, and landscape layouts", () => {
    for (const aspect of [0.3, 0.46, 0.75, 1, 1.33, 1.6, 2.16, 3.55]) {
        const halfHeight = 5.16, halfWidth = halfHeight * aspect;
        const models = layoutModels(items, { halfWidth, halfHeight });
        expect(models.length).toBe(5);
        for (const [i, a] of models.entries()) {
            expect(Math.abs(a.x - 0.5) + a.radius * a.scale).toBeLessThanOrEqual(halfWidth * 0.75 + 1e-8);
            expect(a.y + a.minY * a.scale).toBeGreaterThanOrEqual(0.5 - halfHeight * 0.7 - 1e-8);
            expect(a.y + (a.minY + a.height) * a.scale).toBeLessThanOrEqual(0.5 + halfHeight * 0.7 + 1e-8);
            for (const b of models.slice(i + 1)) {
                const separateX = Math.abs(a.x - b.x) > a.radius * a.scale + b.radius * b.scale;
                const amin = a.y + a.minY * a.scale, bmin = b.y + b.minY * b.scale;
                const separateY = amin + a.height * a.scale < bmin || bmin + b.height * b.scale < amin;
                expect(separateX || separateY).toBe(true);
            }
        }
    }
});

test("moderate screens use balanced rows instead of shrinking everything into one line", () => {
    const models = layoutModels(items, { halfWidth: 8.25, halfHeight: 5.16 });
    expect(new Set(models.map(model => model.row)).size).toBe(2);
    expect(models.map(model => model.row)).toEqual([0, 0, 0, 1, 1]);
    expect(models[0].scale).toBeGreaterThan(items[0].scale);
    const wide = layoutModels(items, { halfWidth: 18.3, halfHeight: 5.16 });
    expect(new Set(wide.map(model => model.row)).size).toBe(1);
});
