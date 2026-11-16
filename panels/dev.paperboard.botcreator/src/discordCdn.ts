// Avatars and server icons for the panel's pages. Any server member picks
// their own avatar, so a page never loads one itself: the service fetches it
// from Discord's CDN, and only from there, and hands the page the bytes.
import { createPictureFetch } from "@mileniumhq/paperapi/net";
import { discordCdnBase } from "./discord";

/** the size Discord is asked for: the panel never draws a picture bigger */
const PICTURE_SIZE = "128";
// a redirect isn't followed, wherever it points; a few hundred avatars are kept
const pictures = createPictureFetch({ maxBytes: 1024 * 1024, timeoutMs: 10_000, maxRedirects: 0, keepChars: 8 * 1024 * 1024 });

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

/** A Discord avatar or server icon as a data: address, for a page to show. */
export async function discordPicture(raw: unknown): Promise<string> {
    return pictures(cdnAddress(raw), { from: "Discord's CDN" });
}
