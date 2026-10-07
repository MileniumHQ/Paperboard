// Minecraft head compositing. A skin is a 64×64 (or legacy 64×32) PNG whose
// head is an 8×8 face at (8,8) plus an 8×8 hat overlay at (40,8); the hat
// layer carries the alpha. Pure and testable so the service never ships an
// image it cannot verify.
import { PNG } from "pngjs";

const FACE_X = 8;
const FACE_Y = 8;
const HAT_X = 40;
const HAT_Y = 8;
const LAYER = 8;

export const MIN_SKIN_WIDTH = 64;
export const MIN_SKIN_HEIGHT = 32;
export const DEFAULT_HEAD_SIZE = 64;
export const MIN_HEAD_SIZE = 8;
export const MAX_HEAD_SIZE = 256;

/**
 * Minecraft inflates the head's second layer (the hat) by 0.5 texels on every
 * side, so the hat box is 9 units to the face's 8 — the same 1.125 factor a
 * 3D skin viewer applies. Rendering the hat to fill the frame therefore draws
 * the face at 8/9 of the frame, centered, and leaves the 0.5-texel overhang
 * to the hat, which is how the head reads in game.
 */
export const HAT_LAYER_SCALE = 1;
export const FACE_LAYER_SCALE = 8 / 9;

export function clampHeadSize(size: unknown): number {
    const n = typeof size === "number" && Number.isFinite(size) ? Math.floor(size) : DEFAULT_HEAD_SIZE;
    return Math.min(MAX_HEAD_SIZE, Math.max(MIN_HEAD_SIZE, n));
}

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/**
 * Sample one 8×8 layer (face or hat) for an output pixel. `scale` is the
 * layer's size relative to the frame: 1 fills the frame, 8/9 sits centered
 * and smaller. Returns null when the pixel falls outside the layer.
 */
function sampleLayer(
    skin: PNG,
    originX: number,
    originY: number,
    scale: number,
    x: number,
    y: number,
    size: number,
): Rgba | null {
    const fx = (x + 0.5) / size;
    const fy = (y + 0.5) / size;
    const lx = 0.5 + (fx - 0.5) / scale;
    const ly = 0.5 + (fy - 0.5) / scale;
    if (lx < 0 || lx >= 1 || ly < 0 || ly >= 1) return null;
    const tx = Math.min(LAYER - 1, Math.floor(lx * LAYER));
    const ty = Math.min(LAYER - 1, Math.floor(ly * LAYER));
    const i = ((originY + ty) * skin.width + (originX + tx)) * 4;
    return {
        r: skin.data[i],
        g: skin.data[i + 1],
        b: skin.data[i + 2],
        a: skin.data[i + 3],
    };
}

/**
 * Whether the hat region carries any visible pixel. A modern skin can have a
 * fully transparent second layer (most default and "bald" skins do); with
 * nothing to show, that layer has no visible extent, so the face fills the
 * frame instead of reserving an invisible 0.5-texel border.
 */
function hatLayerHasAlpha(skin: PNG): boolean {
    for (let y = 0; y < LAYER; y++) {
        for (let x = 0; x < LAYER; x++) {
            const i = ((HAT_Y + y) * skin.width + (HAT_X + x)) * 4;
            if (skin.data[i + 3] > 0) return true;
        }
    }
    return false;
}

/**
 * Decode a skin PNG and composite the head with its hat overlay into a
 * square image. Returns null when the bytes are not a skin we understand
 * (corrupt PNG, or smaller than the head regions) — never a blank image.
 */
export function composeHeadFromSkin(
    skinBytes: Uint8Array,
    size: number = DEFAULT_HEAD_SIZE,
): Uint8Array | null {
    let skin: PNG;
    try {
        skin = PNG.sync.read(Buffer.from(skinBytes));
    } catch (err) {
        console.debug("[skin] not a decodable PNG:", String(err));
        return null;
    }

    const w = skin.width;
    const h = skin.height;
    if (w < MIN_SKIN_WIDTH || h < MIN_SKIN_HEIGHT) return null;
    if (HAT_X + LAYER > w || HAT_Y + LAYER > h) return null;

    // Legacy 64×32 skins have no true overlay layer: the hat region is often
    // opaque black padding, and compositing it paints the face black. Only
    // modern (64×64) skins carry a hat layer.
    const hasOverlay = h >= 64;
    const hasHat = hasOverlay && hatLayerHasAlpha(skin);
    const faceScale = hasHat ? FACE_LAYER_SCALE : 1;

    const out = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const face = sampleLayer(skin, FACE_X, FACE_Y, faceScale, x, y, size);
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            if (face) {
                r = face.r;
                g = face.g;
                b = face.b;
                a = face.a;
            }

            if (hasHat) {
                const hat = sampleLayer(skin, HAT_X, HAT_Y, HAT_LAYER_SCALE, x, y, size);
                if (hat && hat.a > 0) {
                    // source-over: the hat sits in front of the face
                    const hatN = hat.a / 255;
                    const faceN = a / 255;
                    const outA = hatN + faceN * (1 - hatN);
                    if (outA > 0) {
                        r = (hat.r * hatN + r * faceN * (1 - hatN)) / outA;
                        g = (hat.g * hatN + g * faceN * (1 - hatN)) / outA;
                        b = (hat.b * hatN + b * faceN * (1 - hatN)) / outA;
                    }
                    a = Math.round(outA * 255);
                }
            }

            const oi = (y * size + x) * 4;
            out.data[oi] = Math.round(r);
            out.data[oi + 1] = Math.round(g);
            out.data[oi + 2] = Math.round(b);
            out.data[oi + 3] = a;
        }
    }

    return PNG.sync.write(out);
}
