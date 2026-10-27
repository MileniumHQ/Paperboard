import { describe, expect, test } from "bun:test";
import { createFace } from "../src/face/controller";
import { EXPRESSIONS } from "../src/face/expressions";
import { strokeOutline, type Stroke } from "../src/face/geometry";

/** the outline's extent along the stroke and across it */
function extents(s: Stroke) {
    const a = (s.angle * Math.PI) / 180;
    const along = strokeOutline(s).map(([u, v]) => (u - s.x) * Math.cos(a) + (v - s.y) * Math.sin(a));
    const across = strokeOutline(s).map(([u, v]) => -(u - s.x) * Math.sin(a) + (v - s.y) * Math.cos(a));
    const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    return { along: span(along), across: span(across) };
}

describe("the face's mouth", () => {
    test("a short mouth that opens to talk is never taller than it is wide", () => {
        for (const open of [0.02, 0.045, 0.07]) {
            for (const [name, e] of Object.entries(EXPRESSIONS)) {
                const { along, across } = extents({ ...e.mouth, open });
                expect({ name, open, fits: along >= across }).toEqual({ name, open, fits: true });
            }
        }
    });

    test("a closed mouth keeps the shape it was drawn with", () => {
        const m = EXPRESSIONS.surprised.mouth;
        expect(extents(m).along).toBeCloseTo(2 * m.len + m.width, 2); // the caps are polygons
    });

    test("talking shifts a surprised face to one that can talk, and a surprised face asked for mid-talk too", () => {
        const f = createFace({ expression: "surprised" });
        f.talk(true);
        expect(f.expression()).toBe("happy");
        f.express("surprised");
        expect(f.expression()).toBe("happy");
        f.express("thinking");
        expect(f.expression()).toBe("thinking");
        f.talk(false);
        f.express("surprised");
        expect(f.expression()).toBe("surprised");
        f.dispose();
    });
});
