import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LEARN_PANELS } from "../src/site/learn/panels";
import { LEARN_LINKS } from "../src/site/links";

describe("learn page content and original screenshot assets", () => {
    test("every screenshot is unique across learn pages and the main carousel", () => {
        const screenshots = LEARN_PANELS.flatMap(panel => [panel.image, ...panel.features.map(feature => feature.image)]);
        const landing = readFileSync(join(import.meta.dir, "../src/site/landing/Landing.tsx"), "utf8");
        screenshots.push(...[...landing.matchAll(/src: "(\/screens\/[^\"]+)"/g)].map(match => match[1]));
        expect(new Set(screenshots).size).toBe(screenshots.length);
        const digests = screenshots.map(src => createHash("sha256").update(readFileSync(join(import.meta.dir, "../public", src))).digest("hex"));
        expect(new Set(digests).size).toBe(digests.length);
    });
    test("every learn page dedicates a feature to an Actions workflow", () => {
        for (const panel of LEARN_PANELS) {
            expect(panel.features.some(feature => feature.image.includes("actions") && /Actions|workflow|Discord/i.test(feature.description))).toBe(true);
        }
        const bot = LEARN_PANELS.find(panel => panel.slug === "bot-creator")!;
        expect(bot.description).toContain("Actions");
        expect(bot.features[0].image).toBe("/screens/botcreator-actions.png");
    });
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
