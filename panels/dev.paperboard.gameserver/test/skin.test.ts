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
    test("renders the face region", () => {
        const bytes = skinBytes((png) => setPixel(png, 8, 8, 255, 0, 0, 255));
        const head = composeHeadFromSkin(bytes);
        expect(head).not.toBeNull();
        expect(pixelAt(head!, 0, 0)).toEqual([255, 0, 0, 255]);
    });

    test("composites an opaque hat layer over the face", () => {
        const bytes = skinBytes((png) => {
            setPixel(png, 8, 8, 255, 0, 0, 255);
            setPixel(png, 40, 8, 0, 0, 255, 255);
        });
        const head = composeHeadFromSkin(bytes);
        expect(pixelAt(head!, 0, 0)).toEqual([0, 0, 255, 255]);
    });

    test("blends a translucent hat layer", () => {
        const bytes = skinBytes((png) => {
            setPixel(png, 8, 8, 255, 0, 0, 255);
            setPixel(png, 40, 8, 0, 0, 255, 128);
        });
        const [r, g, b, a] = pixelAt(composeHeadFromSkin(bytes)!, 0, 0);
        expect(a).toBe(255);
        expect(r).toBeGreaterThan(100);
        expect(r).toBeLessThan(160);
        expect(g).toBe(0);
        expect(b).toBeGreaterThan(100);
        expect(b).toBeLessThan(160);
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

    test("scaling the base layer keeps the frame opaque (no transparent rim)", () => {
        // the base is sampled slightly smaller than the overlay; edge clamping
        // must still fill every pixel so a hat-less skin has no gap
        const bytes = skinBytes((png) => {
            for (let y = 8; y < 16; y++) {
                for (let x = 8; x < 16; x++) setPixel(png, x, y, 255, 0, 0, 255);
            }
        });
        const head = composeHeadFromSkin(bytes);
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
