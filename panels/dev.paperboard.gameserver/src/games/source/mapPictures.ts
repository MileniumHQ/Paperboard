import { apiFetch } from "../../lib/userAgent";
import type { SourceMapPictures, SourceMapPictureSource } from "./index";

// A Source dedicated server ships no map pictures (its texture archives name
// them, but the files aren't downloaded). A game's spec can name a wiki page
// that lists its maps with a picture each, in the MediaWiki table layout the
// Official Team Fortress Wiki uses: a row holds the map's file name in <code>
// and a thumbnail <img>. The service reads that page at runtime and hands the
// UI absolute picture addresses; nothing of the wiki's is stored in the app.

/** How long a page's answer is kept: the wiki changes when a game adds maps, not by the hour. */
const KEEP_MS = 24 * 60 * 60 * 1000;
/** How long a failure is remembered, so a screen that asks again isn't another request to a wiki that just refused. */
const FAILURE_MS = 60 * 1000;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

const MAP_NAME = /^[a-z0-9_]+$/i;

const decode = (text: string) => text.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");

/**
 * The picture of each map a wiki list page shows, by file name: the largest
 * rendering the page itself offers in the row's image (its srcset, which for
 * the Official Team Fortress Wiki tops out at 300 pixels). The wiki keeps a
 * thumbnail only at the widths some page has shown (640 pixels exists for
 * three maps in four, 600 for nearly all), so a width asked for beyond what
 * the page offers is a 404 for some maps; the page's own are always there.
 * Pictures must live on the page's own site. Throws when the page lists no map
 * picture, which is what a changed layout looks like.
 */
export function parseMapPictures(html: string, page: string): Record<string, string> {
    const origin = new URL(page).origin;
    const pictures: Record<string, string> = {};
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = row[1]!;
        const codes = [...cells.matchAll(/<code>\s*([^<]*?)\s*<\/code>/g)].map((m) => m[1]!);
        const image = /<img\b[^>]*?\ssrc="([^"]+)"(?:[^>]*?\ssrcset="([^"]*)")?/.exec(cells);
        // a row holding one file name and a picture is a map; heading and prefix rows are not
        if (codes.length !== 1 || !image || !MAP_NAME.test(codes[0]!)) continue;
        const url = largestPicture(decode(image[1]!), image[2] === undefined ? "" : decode(image[2]), page);
        if (url.origin !== origin) throw new Error(`${page} shows the picture of ${codes[0]} from ${url.origin}, which is not its own site`);
        pictures[codes[0]!.toLowerCase()] ??= url.href;
    }
    if (Object.keys(pictures).length === 0) throw new Error(`${page} lists no map pictures; its layout may have changed`);
    return pictures;
}

/** The src, or the srcset candidate with the highest density or width. */
function largestPicture(src: string, srcset: string, page: string): URL {
    let best = { size: 1, url: src };
    for (const candidate of srcset.split(",")) {
        const [url, descriptor = "1x"] = candidate.trim().split(/\s+/);
        const size = /^(\d+(?:\.\d+)?)[xw]$/.exec(descriptor);
        if (url && size && Number(size[1]) > best.size) best = { size: Number(size[1]), url };
    }
    return new URL(best.url, page);
}

type Kept = { at: number; value: SourceMapPictures } | { at: number; error: Error };
const kept = new Map<string, Kept>();
const inFlight = new Map<string, Promise<SourceMapPictures>>();

async function load(source: SourceMapPictureSource): Promise<SourceMapPictures> {
    let response: Response;
    try {
        response = await apiFetch(source.page, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "text/html" } });
    } catch (err) {
        throw new Error(`Couldn't reach ${source.name} for map pictures: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) throw new Error(`${source.name} answered HTTP ${response.status} for its map list`);
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error(`${source.name}'s map list is larger than expected`);
    const html = await response.text();
    if (html.length > MAX_BYTES) throw new Error(`${source.name}'s map list is larger than expected`);
    let pictures: Record<string, string>;
    try {
        pictures = parseMapPictures(html, source.page);
    } catch (err) {
        throw new Error(`Couldn't read map pictures from ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { source: { name: source.name, url: source.page }, pictures };
}

/** A game's map pictures: from memory when fetched in the last day, else from its wiki, asked once at a time. */
export async function mapPictures(source: SourceMapPictureSource): Promise<SourceMapPictures> {
    const now = Date.now();
    const have = kept.get(source.page);
    if (have && now - have.at < ("error" in have ? FAILURE_MS : KEEP_MS)) {
        if ("error" in have) throw have.error;
        return have.value;
    }
    let pending = inFlight.get(source.page);
    if (!pending) {
        pending = load(source)
            .then((value) => { kept.set(source.page, { at: Date.now(), value }); return value; })
            .catch((error: Error) => { kept.set(source.page, { at: Date.now(), error }); throw error; })
            .finally(() => inFlight.delete(source.page));
        inFlight.set(source.page, pending);
    }
    return pending;
}

/** Forgets what was fetched, for tests that serve a page twice. */
export function forgetMapPictures(): void {
    kept.clear();
}
