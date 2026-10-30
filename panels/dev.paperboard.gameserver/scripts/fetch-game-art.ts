/**
 * Operator script: downloads each game's poster (portrait cover) and banner once
 * and commits them as WebP under public/assets/games/<id>/. The panel never
 * fetches art at runtime. Needs `ffmpeg` (with libwebp) on PATH and network access.
 *
 *   bun scripts/fetch-game-art.ts            # every game
 *   bun scripts/fetch-game-art.ts palworld   # only the named games
 *
 * Sources need no credentials: Steam's public store CDN, and Microsoft Store's
 * public display catalog for Minecraft, which isn't on Steam. (Discord's own
 * game covers are IGDB art, which needs Twitch client credentials, and its CDN
 * only serves a 264px square crop of them.) The resolved URLs are recorded in
 * scripts/game-art-sources.json.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crop } from "./game-art-crop";

type Source =
    | { kind: "steam"; app: number; bannerFocus?: number }
    | { kind: "microsoft"; product: string; /** where the 3:1 banner band starts in the 16:9 hero, 0 top – 1 bottom */ bannerFocus: number };

const GAMES: Readonly<Record<string, Source>> = {
    minecraft: { kind: "microsoft", product: "9NBLGGH2JHXJ", bannerFocus: 0.5 },
    terraria: { kind: "steam", app: 105600 },
    "counter-strike-2": { kind: "steam", app: 730 },
    "team-fortress-2": { kind: "steam", app: 440 },
    "garrys-mod": { kind: "steam", app: 4000 },
    palworld: { kind: "steam", app: 1623730 },
    rust: { kind: "steam", app: 252490 },
};

/** Posters are shown a few hundred px tall at most, banners across a card. */
const POSTER = { width: 300, height: 450, quality: 82 };
const BANNER = { width: 1280, height: 413, quality: 80 };
const STEAM = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const here = new URL(".", import.meta.url).pathname;
const assets = join(here, "..", "public", "assets", "games");
const sourcesFile = join(here, "game-art-sources.json");

async function download(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

async function ffmpeg(args: string[]): Promise<void> {
    const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0) throw new Error(`ffmpeg ${args.join(" ")} exited with ${code}`);
}

async function resolveUrls(source: Source): Promise<{ poster: string; banner: string }> {
    if (source.kind === "steam")
        return { poster: `${STEAM}/${source.app}/library_600x900_2x.jpg`, banner: `${STEAM}/${source.app}/library_hero.jpg` };
    const catalog = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${source.product}&market=US&languages=en-US`;
    const response = await fetch(catalog);
    if (!response.ok) throw new Error(`${catalog} answered ${response.status}`);
    const images: { ImagePurpose: string; Uri: string; Width: number; Height: number }[] =
        (await response.json()).Products?.[0]?.LocalizedProperties?.[0]?.Images ?? [];
    const best = (purpose: string) => {
        const found = images.filter((image) => image.ImagePurpose === purpose).sort((a, b) => b.Width * b.Height - a.Width * a.Height)[0];
        if (!found) throw new Error(`${catalog} lists no ${purpose} image`);
        return `https:${found.Uri}`;
    };
    return { poster: best("Poster"), banner: best("SuperHeroArt") };
}

async function fetchGame(id: string, source: Source, work: string): Promise<{ poster: string; banner: string }> {
    const urls = await resolveUrls(source);
    const out = join(assets, id);
    await mkdir(out, { recursive: true });
    const poster = join(work, `${id}-poster`);
    const banner = join(work, `${id}-banner`);
    await Bun.write(poster, await download(urls.poster));
    await Bun.write(banner, await download(urls.banner));
    await ffmpeg(["-i", poster, "-vf", crop(POSTER.width, POSTER.height), "-c:v", "libwebp", "-quality", String(POSTER.quality), join(out, "poster.webp")]);
    await ffmpeg(["-i", banner, "-vf", crop(BANNER.width, BANNER.height, source.bannerFocus), "-c:v", "libwebp", "-quality", String(BANNER.quality), join(out, "banner.webp")]);
    return urls;
}

const wanted = process.argv.slice(2);
for (const id of wanted) if (!Object.hasOwn(GAMES, id)) throw new Error(`No art source for "${id}"; known: ${Object.keys(GAMES).join(", ")}`);
const work = await mkdtemp(join(tmpdir(), "pb-game-art-"));
try {
    const recorded: Record<string, { poster: string; banner: string }> = (await Bun.file(sourcesFile).exists()) ? await Bun.file(sourcesFile).json() : {};
    for (const [id, source] of Object.entries(GAMES)) {
        if (wanted.length && !wanted.includes(id)) continue;
        recorded[id] = { ...recorded[id], ...await fetchGame(id, source, work) };
        console.log(`${id}: poster and banner written`);
    }
    await Bun.write(sourcesFile, `${JSON.stringify(recorded, null, 4)}\n`);
} finally {
    await rm(work, { recursive: true, force: true });
}
