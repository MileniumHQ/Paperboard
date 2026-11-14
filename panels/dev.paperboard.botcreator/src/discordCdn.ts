// Avatars and server icons for the panel's pages. Any server member picks
// their own avatar, so a page never loads one itself: the service fetches it
// from Discord's CDN, and only from there, and hands the page the bytes.
import { discordCdnBase } from "./session";
import { errorToMessage } from "./types";

const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** the size Discord is asked for: the panel never draws a picture bigger */
const PICTURE_SIZE = "128";
const MAX_PICTURE_BYTES = 1024 * 1024;
const FETCH_MS = 10_000;
const CACHE_CAP = 256;

// by address, oldest first; a failed fetch is not kept, so the next ask tries again
const cache = new Map<string, Promise<string>>();

/** The Discord CDN address `raw` is, or why it isn't one. */
function cdnAddress(raw: unknown): URL {
    const cdn = new URL(`${discordCdnBase()}/`);
    let url: URL;
    try {
        url = new URL(typeof raw === "string" ? raw : "");
    } catch {
        throw new Error(`"${String(raw)}" isn't a picture's address.`);
    }
    if (url.origin !== cdn.origin || !url.pathname.startsWith(cdn.pathname)) {
        throw new Error(`Bot Creator only shows pictures from Discord's CDN, not ${url.origin}.`);
    }
    url.searchParams.set("size", PICTURE_SIZE);
    return url;
}

async function fetchPicture(url: URL): Promise<string> {
    let response: Response;
    try {
        response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_MS) });
    } catch (err) {
        throw new Error(`Discord's CDN couldn't be reached: ${errorToMessage(err)}`);
    }
    if (!response.ok) throw new Error(`Discord's CDN answered ${response.status} for ${url.pathname}.`);
    const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!PICTURE_TYPES.has(type)) throw new Error(`Discord's CDN sent ${type || "something"} that isn't a picture.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_PICTURE_BYTES) throw new Error(`The picture at ${url.pathname} is bigger than ${MAX_PICTURE_BYTES} bytes.`);
    return `data:${type};base64,${bytes.toString("base64")}`;
}

/** A Discord avatar or server icon as a data: address, for a page to show. */
export async function discordPicture(raw: unknown): Promise<string> {
    const url = cdnAddress(raw);
    const key = url.href;
    const known = cache.get(key);
    if (known) return known;
    const picture = fetchPicture(url).catch((err: unknown) => {
        cache.delete(key);
        throw err;
    });
    cache.set(key, picture);
    if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value!);
    return picture;
}
