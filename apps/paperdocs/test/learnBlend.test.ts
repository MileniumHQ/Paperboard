import { describe, expect, test } from "bun:test";
import { blendField } from "../src/site/learn/blend";

// A blended learn field has one pool per colour, in list order down the page,
// whatever the count: a fixed set of slots left the field transparent when a
// colour was missing and dropped any extra.
describe("learn blend field", () => {
    const pools = (field: string) => field.match(/radial-gradient\(/g)?.length ?? 0;
    const heights = (field: string) => [...field.matchAll(/ at \d+% ([\d.]+)%/g)].map((match) => Number(match[1]));

    for (const count of [1, 2, 5, 7]) {
        test(`${count} colour${count === 1 ? "" : "s"} make ${count} pool${count === 1 ? "" : "s"}, top to bottom`, () => {
            const colors = Array.from({ length: count }, (_, index) => `var(--colour-${index})`);
            const field = blendField(colors);
            expect(pools(field)).toBe(count);
            const order = colors.map((color) => field.indexOf(color));
            expect(order).toEqual([...order].sort((a, b) => a - b));
            const ys = heights(field);
            expect(ys).toEqual([...ys].sort((a, b) => a - b));
            expect(new Set(ys).size).toBe(count);
        });
    }
});
