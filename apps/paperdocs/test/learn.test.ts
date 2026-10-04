import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEARN_PANELS } from "../src/site/learn/panels";
import { LEARN_LINKS } from "../src/site/links";

describe("learn page content and original screenshot assets", () => {
    test("every advertised Learn panel has exactly one content definition", () => {
        expect(new Set(LEARN_PANELS.map((panel) => panel.slug)).size).toBe(LEARN_PANELS.length);
        expect(LEARN_LINKS.map((link) => link.href.replace(/\/$/, "")).sort()).toEqual(
            LEARN_PANELS.map((panel) => `/${panel.slug}`).sort(),
        );
    });
    for (const panel of LEARN_PANELS) {
        test(`${panel.name} has complete features and native 1600 × 1200 screenshots`, () => {
            expect(panel.features.length).toBeGreaterThanOrEqual(3);
            for (const feature of panel.features) {
                expect(feature.title.length).toBeGreaterThan(8);
                expect(feature.description.length).toBeGreaterThan(50);
                expect(feature.alt.length).toBeGreaterThan(10);
            }
            const images = new Set([
                panel.image,
                ...panel.features.map((feature) => feature.image),
            ]);
            for (const src of images) {
                const png = readFileSync(join(import.meta.dir, "../public", src));
                expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
                expect(png.readUInt32BE(16)).toBe(1600);
                expect(png.readUInt32BE(20)).toBe(1200);
            }
        });
    }
});
