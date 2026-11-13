import { loadPng } from "../../core/lazy";

// Rust draws its map with `world.rendermap <scale>`: a PNG of the world at
// that many pixels a metre, inside an ocean border of RENDER_MARGIN pixels a
// side whatever the scale. The picture Paperboard keeps is the world alone,
// PICTURE_SIZE across, so the border is cut off here.

/** the ocean border world.rendermap draws around the world, in pixels a side (measured on build 26498655) */
export const RENDER_MARGIN = 500;
/** how many pixels across the kept picture is */
export const PICTURE_SIZE = 1024;

/** The scale that draws a world of `size` metres PICTURE_SIZE pixels across. */
export const renderScale = (size: number) => (PICTURE_SIZE / size).toFixed(4);

/** The world alone from a render: the picture with RENDER_MARGIN cut off each side, as an opaque RGB PNG. */
export async function worldPicture(render: Buffer): Promise<Buffer> {
    const { PNG } = await loadPng();
    let image;
    try {
        image = PNG.sync.read(render);
    } catch (err) {
        throw new Error(`Rust's map render isn't a readable PNG: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { width, height } = image;
    if (width !== height || width <= RENDER_MARGIN * 2) throw new Error(`Rust's map render is ${width}×${height}, not a map inside its ocean border`);
    const side = width - RENDER_MARGIN * 2;
    const world = new PNG({ width: side, height: side });
    PNG.bitblt(image, world, RENDER_MARGIN, RENDER_MARGIN, side, side, 0, 0);
    // the ocean and land are opaque, and a picture without the alpha channel is a quarter smaller
    return PNG.sync.write(world, { colorType: 2, inputColorType: 6, deflateLevel: 9 });
}
