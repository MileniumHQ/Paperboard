import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { composeHeadFromSkin } from "../src/core/skin";

function setPixel(png: PNG, x: number, y: number, r: number, g: number, b: number, a: number) {
    const i = (y * png.width + x) * 4;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
}

function fillLayer(png: PNG, x0: number, y0: number, r: number, g: number, b: number, a: number) {
    for (let y = y0; y < y0 + 8; y++) {
        for (let x = x0; x < x0 + 8; x++) setPixel(png, x, y, r, g, b, a);
    }
}

function skinBytes(paint: (png: PNG) => void): Uint8Array {
    const png = new PNG({ width: 64, height: 64 });
    paint(png);
    return PNG.sync.write(png);
}

function pixelAt(bytes: Uint8Array, x: number, y: number): number[] {
    const png = PNG.sync.read(Buffer.from(bytes));
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

describe("composeHeadFromSkin", () => {
    test("a visible hat draws the face at 8/9 of the frame, centered", () => {
        // the hat's 9-unit extent is the frame; the face occupies the central
        // 8 units, so the outer ~4px on each side is hat-only. A single opaque
        // hat pixel is enough to reserve that extent.
        const bytes = skinBytes((png) => {
            fillLayer(png, 8, 8, 255, 0, 0, 255);
            setPixel(png, 40, 8, 0, 0, 255, 255);
        });
        const head = composeHeadFromSkin(bytes);
        expect(head).not.toBeNull();
        expect(pixelAt(head!, 0, 0)).toEqual([0, 0, 255, 255]);
        expect(pixelAt(head!, 3, 32)).toEqual([0, 0, 0, 0]);
        expect(pixelAt(head!, 4, 32)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(head!, 32, 32)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(head!, 59, 32)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(head!, 60, 32)).toEqual([0, 0, 0, 0]);
    });

    test("a fully transparent hat leaves the face filling the frame", () => {
        // most default/bald skins have no visible second layer; reserving the
        // inflated extent for it would shrink the head into a transparent rim
        const bytes = skinBytes((png) => fillLayer(png, 8, 8, 255, 0, 0, 255));
        const head = composeHeadFromSkin(bytes);
        expect(head).not.toBeNull();
        expect(pixelAt(head!, 0, 0)).toEqual([255, 0, 0, 255]);
        expect(pixelAt(head!, 32, 32)).toEqual([255, 0, 0, 255]);
    });

    test("composites an opaque hat layer over the face, filling the frame", () => {
        const bytes = skinBytes((png) => {
            fillLayer(png, 8, 8, 255, 0, 0, 255);
            fillLayer(png, 40, 8, 0, 0, 255, 255);
        });
        const head = composeHeadFromSkin(bytes);
        // the hat reaches the overhang ring and covers the face
        expect(pixelAt(head!, 0, 0)).toEqual([0, 0, 255, 255]);
        expect(pixelAt(head!, 32, 32)).toEqual([0, 0, 255, 255]);
    });

    test("blends a translucent hat layer over the face and keeps hat-only alpha", () => {
        const bytes = skinBytes((png) => {
            fillLayer(png, 8, 8, 255, 0, 0, 255);
            fillLayer(png, 40, 8, 0, 0, 255, 128);
        });
        const head = composeHeadFromSkin(bytes);
        // over the face the layers blend to an opaque purple...
        const [r, g, b, a] = pixelAt(head!, 32, 32);
        expect(a).toBe(255);
        expect(r).toBeGreaterThan(100);
        expect(r).toBeLessThan(160);
        expect(g).toBe(0);
        expect(b).toBeGreaterThan(100);
        expect(b).toBeLessThan(160);
        // ...while the overhang ring is hat only, so it keeps the hat's alpha
        expect(pixelAt(head!, 0, 0)).toEqual([0, 0, 255, 128]);
    });

    test("ignores the overlay on legacy 64×32 skins", () => {
        // legacy skins pad the hat region with opaque black; it must not
        // paint over the face
        const legacy = new PNG({ width: 64, height: 32 });
        setPixel(legacy, 8, 8, 255, 0, 0, 255);
        setPixel(legacy, 40, 8, 0, 0, 0, 255);
        const head = composeHeadFromSkin(PNG.sync.write(legacy));
        expect(head).not.toBeNull();
        expect(pixelAt(head!, 0, 0)).toEqual([255, 0, 0, 255]);
    });

    test("a legacy skin's face fills the frame (no hat, no transparent rim)", () => {
        // with no second layer there is no inflated extent to reserve, so the
        // face takes the whole frame and every pixel is opaque
        const legacy = new PNG({ width: 64, height: 32 });
        fillLayer(legacy, 8, 8, 255, 0, 0, 255);
        const head = composeHeadFromSkin(PNG.sync.write(legacy));
        expect(head).not.toBeNull();
        const png = PNG.sync.read(Buffer.from(head!));
        for (let i = 3; i < png.data.length; i += 4) {
            expect(png.data[i]).toBe(255);
        }
    });

    test("returns null for a skin smaller than the head regions", () => {
        const small = new PNG({ width: 32, height: 32 });
        expect(composeHeadFromSkin(PNG.sync.write(small))).toBeNull();
    });

    test("returns null for bytes that are not a PNG", () => {
        expect(composeHeadFromSkin(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    });
});
