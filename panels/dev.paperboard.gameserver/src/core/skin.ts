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
 * The base head is sampled slightly smaller and centered under the hat
 * overlay, mirroring Minecraft's model where the overlay sits just outside
 * the head. Without it the two layers line up pixel-for-pixel and an opaque
 * hat reads as a flat sticker instead of hair/headwear over the face.
 */
export const BASE_LAYER_SCALE = 0.92;

export function clampHeadSize(size: unknown): number {
    const n = typeof size === "number" && Number.isFinite(size) ? Math.floor(size) : DEFAULT_HEAD_SIZE;
    return Math.min(MAX_HEAD_SIZE, Math.max(MIN_HEAD_SIZE, n));
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

    const out = new PNG({ width: size, height: size });
    for (let y = 0; y < size; y++) {
        const fy = (y + 0.5) / size;
        // base layer: compressed toward the center, edge-clamped so it still
        // reaches the frame (no transparent rim on hat-less skins)
        const baseY = Math.min(
            LAYER - 1,
            Math.max(0, Math.floor((0.5 + (fy - 0.5) * BASE_LAYER_SCALE) * LAYER)),
        );
        // overlay: full size, exactly aligned to the frame
        const hatY = Math.min(LAYER - 1, Math.floor(fy * LAYER));
        for (let x = 0; x < size; x++) {
            const fx = (x + 0.5) / size;
            const baseX = Math.min(
                LAYER - 1,
                Math.max(0, Math.floor((0.5 + (fx - 0.5) * BASE_LAYER_SCALE) * LAYER)),
            );
            const hatX = Math.min(LAYER - 1, Math.floor(fx * LAYER));

            const fi = ((FACE_Y + baseY) * w + (FACE_X + baseX)) * 4;
            const hi = ((HAT_Y + hatY) * w + (HAT_X + hatX)) * 4;
            const oi = (y * size + x) * 4;

            let r = skin.data[fi];
            let g = skin.data[fi + 1];
            let b = skin.data[fi + 2];
            let a = skin.data[fi + 3];

            const hatA = hasOverlay ? skin.data[hi + 3] : 0;
            if (hatA > 0) {
                const hatN = hatA / 255;
                const faceN = a / 255;
                const outA = hatN + faceN * (1 - hatN);
                if (outA > 0) {
                    r = (skin.data[hi] * hatN + r * faceN * (1 - hatN)) / outA;
                    g = (skin.data[hi + 1] * hatN + g * faceN * (1 - hatN)) / outA;
                    b = (skin.data[hi + 2] * hatN + b * faceN * (1 - hatN)) / outA;
                }
                a = Math.round(outA * 255);
            }

            out.data[oi] = Math.round(r);
            out.data[oi + 1] = Math.round(g);
            out.data[oi + 2] = Math.round(b);
            out.data[oi + 3] = a;
        }
    }

    return PNG.sync.write(out);
}
