import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

// Writes the responsive WebP copies the prerendered pages reference
// (src/site/landing/images.ts names them /img/<source>-<width>.webp). Each is
// resized from its PNG in public/, so replacing a screenshot in place
// refreshes its copies on the next build. Encodes are cached by source bytes
// and width outside the repo, in node_modules/.cache.

const VARIANT = /\/img\/((?:screens|pictures)\/[\w-]+|[\w-]+)-(\d+)\.webp/g;
const SCREEN_ASPECT = 4 / 3;

export function referencedVariants(html) {
    return [...html.matchAll(VARIANT)].map((match) => ({
        url: match[0],
        source: `/${match[1]}.png`,
        width: Number(match[2]),
    }));
}

export async function writeMarketingImages({ publicDir, dist, cacheDir, urls }) {
    const unique = new Map(urls.map((variant) => [variant.url, variant]));
    const bySource = new Map();
    for (const variant of unique.values()) {
        const list = bySource.get(variant.source) ?? [];
        list.push(variant);
        bySource.set(variant.source, list);
    }
    await mkdir(cacheDir, { recursive: true });
    let encoded = 0;
    for (const [source, variants] of bySource) {
        const file = join(publicDir, source);
        if (!existsSync(file)) throw new Error(`paperdocs: image variant source ${source} is missing`);
        const bytes = await readFile(file);
        const { width, height } = await sharp(bytes).metadata();
        // Screenshots reserve a 4:3 box (Screenshot.tsx); a shot in another
        // shape would be cropped or letterboxed silently.
        if (source.startsWith("/screens/") && Math.abs(width / height - SCREEN_ASPECT) > 0.01) {
            throw new Error(`paperdocs: ${source} is ${width} × ${height}, not 4:3`);
        }
        const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
        for (const variant of variants) {
            if (variant.width > width) {
                throw new Error(
                    `paperdocs: ${variant.url} asks for ${variant.width}px from a ${width}px source`,
                );
            }
            const cached = join(cacheDir, `${digest}-${variant.width}.webp`);
            if (!existsSync(cached)) {
                const out = await sharp(bytes)
                    .resize({ width: variant.width })
                    .webp({ quality: 82, effort: 5 })
                    .toBuffer();
                await writeFile(cached, out);
                encoded += 1;
            }
            const target = join(dist, variant.url);
            await mkdir(dirname(target), { recursive: true });
            await copyFile(cached, target);
        }
    }
    return { variants: unique.size, encoded };
}
