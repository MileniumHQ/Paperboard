/**
 * Operator script: downloads each game's poster (portrait cover), banner and
 * icon once and commits them as WebP under public/assets/games/<id>/. The panel never
 * fetches art at runtime. Needs `ffmpeg` (with libwebp) on PATH and network access.
 *
 *   bun scripts/fetch-game-art.ts            # every game
 *   bun scripts/fetch-game-art.ts palworld   # only the named games
 *
 * Sources need no credentials: Steam's public store CDN, and Microsoft Store's
 * public display catalog for Minecraft, which isn't on Steam. A Steam game's
 * icon is the client icon (an .ico) named by the `clienticon` hash in its
 * app info; the hash below was read from https://api.steamcmd.net/v1/info/<app>
 * and changes only when the publisher replaces the icon. (Discord's own
 * game covers are IGDB art, which needs Twitch client credentials, and its CDN
 * only serves a 264px square crop of them.) The resolved URLs are recorded in
 * scripts/game-art-sources.json.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crop } from "./game-art-crop";

type Source =
    | { kind: "steam"; app: number; clienticon: string; bannerFocus?: number }
    | { kind: "microsoft"; product: string; /** where the 3:1 banner band starts in the 16:9 hero, 0 top – 1 bottom */ bannerFocus: number };

const GAMES: Readonly<Record<string, Source>> = {
    minecraft: { kind: "microsoft", product: "9NBLGGH2JHXJ", bannerFocus: 0.5 },
    terraria: { kind: "steam", app: 105600, clienticon: "a4ce7b163832f35ffcbf560ca40974bccd5d4cd5" },
    "counter-strike-2": { kind: "steam", app: 730, clienticon: "324b323045b09bace182f928f4104dfcd93cb7f3" },
    "team-fortress-2": { kind: "steam", app: 440, clienticon: "f568912870a4684f9ec76277a1a404dda6bab213" },
    "garrys-mod": { kind: "steam", app: 4000, clienticon: "01b545c997d68f6c4ac18ccef6c57d1d5d690e03" },
    palworld: { kind: "steam", app: 1623730, clienticon: "22a20bdaa6d782f60caa45eb7b02fc2411dcd988" },
    rust: { kind: "steam", app: 252490, clienticon: "acf87ad23570b3c81f8c9cfc19544a07edd8b632" },
};

/** Posters are shown a few hundred px tall at most, banners across a card. */
const POSTER = { width: 300, height: 450, quality: 82 };
const BANNER = { width: 1280, height: 413, quality: 80 };
/** Icons stand in avatars and card corners; lossless keeps pixel art crisp. */
const ICON = { size: 128 };
const STEAM = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const STEAM_ICONS = "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";
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

type Urls = { poster: string; banner: string; icon: string };

async function resolveUrls(source: Source): Promise<Urls> {
    if (source.kind === "steam")
        return {
            poster: `${STEAM}/${source.app}/library_600x900_2x.jpg`,
            banner: `${STEAM}/${source.app}/library_hero.jpg`,
            icon: `${STEAM_ICONS}/${source.app}/${source.clienticon}.ico`,
        };
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
    return { poster: best("Poster"), banner: best("SuperHeroArt"), icon: best("Logo") };
}

/** the stream index of an .ico's largest image; a plain image has only stream 0 */
async function largestStream(file: string): Promise<number> {
    const child = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "stream=index,width,height", "-of", "csv=p=0", file], { stdout: "pipe", stderr: "inherit" });
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0) throw new Error(`ffprobe ${file} exited with ${code}`);
    const streams = text.trim().split("\n").map((line) => line.split(",").map(Number) as [number, number, number]);
    if (!streams.length || streams.some((s) => s.some(Number.isNaN))) throw new Error(`ffprobe found no images in ${file}`);
    return streams.sort((a, b) => b[1] * b[2] - a[1] * a[2])[0][0];
}

async function fetchGame(id: string, source: Source, work: string): Promise<Urls> {
    const urls = await resolveUrls(source);
    const out = join(assets, id);
    await mkdir(out, { recursive: true });
    const poster = join(work, `${id}-poster`);
    const banner = join(work, `${id}-banner`);
    await Bun.write(poster, await download(urls.poster));
    await Bun.write(banner, await download(urls.banner));
    await ffmpeg(["-i", poster, "-vf", crop(POSTER.width, POSTER.height), "-c:v", "libwebp", "-quality", String(POSTER.quality), join(out, "poster.webp")]);
    await ffmpeg(["-i", banner, "-vf", crop(BANNER.width, BANNER.height, source.bannerFocus), "-c:v", "libwebp", "-quality", String(BANNER.quality), join(out, "banner.webp")]);
    const icon = join(work, `${id}-icon`);
    await Bun.write(icon, await download(urls.icon));
    await ffmpeg(["-i", icon, "-map", `0:${await largestStream(icon)}`, "-vf", crop(ICON.size, ICON.size), "-c:v", "libwebp", "-lossless", "1", join(out, "icon.webp")]);
    return urls;
}

const wanted = process.argv.slice(2);
for (const id of wanted) if (!Object.hasOwn(GAMES, id)) throw new Error(`No art source for "${id}"; known: ${Object.keys(GAMES).join(", ")}`);
const work = await mkdtemp(join(tmpdir(), "pb-game-art-"));
try {
    const recorded: Record<string, Partial<Urls>> = (await Bun.file(sourcesFile).exists()) ? await Bun.file(sourcesFile).json() : {};
    for (const [id, source] of Object.entries(GAMES)) {
        if (wanted.length && !wanted.includes(id)) continue;
        recorded[id] = { ...recorded[id], ...await fetchGame(id, source, work) };
        console.log(`${id}: poster, banner and icon written`);
    }
    await Bun.write(sourcesFile, `${JSON.stringify(recorded, null, 4)}\n`);
} finally {
    await rm(work, { recursive: true, force: true });
}
