import { expect, test } from "bun:test";
import { layoutModels } from "../public/js/model-layout.mjs";

test("models reserve their whole rotating silhouette, including off-centre origins", () => {
    const items = [1.7, 1.4, 0.7, 0.6, 2].map((radius, i) => ({ radius, height: i + 2, minY: -0.3, scale: 0.4 }));
    for (const stacked of [false, true]) {
        const models = layoutModels(items, { stacked, halfWidth: 2, halfHeight: 5 });
        for (const [i, a] of models.entries()) {
            expect(Math.abs(a.x - 0.5) + a.radius * a.scale).toBeLessThanOrEqual(1.5 + 1e-8);
            for (const b of models.slice(i + 1)) {
                const separateX = Math.abs(a.x - b.x) > a.radius * a.scale + b.radius * b.scale;
                const amin = a.y + a.minY * a.scale, bmin = b.y + b.minY * b.scale;
                const separateY = amin + a.height * a.scale < bmin || bmin + b.height * b.scale < amin;
                expect(separateX || separateY).toBe(true);
            }
        }
    }
});
