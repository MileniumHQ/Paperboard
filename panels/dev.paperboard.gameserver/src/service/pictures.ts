// Pictures from elsewhere for the panel's pages: an add-on's icon, a Steam
// Workshop preview, a wiki's map thumbnail, an image in an add-on's page. A
// page never loads such an address itself. The service fetches it under the
// public-address rule (fetchPublic: public addresses only, size and time
// capped, every redirect checked), from the hosts its source keeps pictures
// on, checks the answer is a picture, and hands the page a data: address.
import { createPictureFetch } from "@mileniumhq/paperapi/net";
import type { PictureSource } from "./contract";

/**
 * The hosts each source's pictures are on; null for any public host (an
 * add-on page's own images, which its author links from anywhere). A host
 * listed here on this computer (127.0.0.1) is reached without the
 * public-address rule, since code, not a page, named it: a test's stand-in.
 */
export const PICTURE_HOSTS: Record<PictureSource, string[] | null> = {
    modrinth: ["cdn.modrinth.com"],
    "steam-workshop": ["images.steamusercontent.com", "steamuserimages-a.akamaihd.net"],
    web: null,
};
const SOURCE_NAMES: Record<PictureSource, string> = { modrinth: "Modrinth", "steam-workshop": "the Steam Workshop", web: "the add-on's page" };

export const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
// six at a time, as a browser asks a site: a page of a hundred maps asks no harder
const pictures = createPictureFetch({ maxBytes: MAX_PICTURE_BYTES, timeoutMs: 20_000, keepChars: 64 * 1024 * 1024, atOnce: 6 });

/**
 * The picture at `raw` as a data: address, fetched only from one of `hosts`
 * (null: any public host); `from` names the source in a failure. Throws why
 * a picture is refused or couldn't be fetched.
 */
export function servedPicture(raw: unknown, hosts: readonly string[] | null, from: string): Promise<string> {
    let url: URL;
    try {
        url = new URL(typeof raw === "string" ? raw : "");
    } catch {
        return Promise.reject(new Error(`"${String(raw).slice(0, 200)}" isn't a picture's address`));
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return Promise.reject(new Error(`Pictures are fetched over the web, not ${url.protocol}`));
    if (hosts && !hosts.includes(url.host)) return Promise.reject(new Error(`${from} keeps its pictures on ${hosts.join(" and ")}, not ${url.host}`));
    const trusted = hosts !== null && url.hostname === "127.0.0.1";
    return pictures(url, { from, trustedOrigins: trusted ? [url.origin] : [] });
}

/** The panel's picture call: `url` from `from`, one of PICTURE_HOSTS' sources. */
export function pictureCall(input: { from?: unknown; url?: unknown } | undefined): Promise<string> {
    const from = input?.from;
    if (typeof from !== "string" || !Object.hasOwn(PICTURE_HOSTS, from)) return Promise.reject(new Error(`There is no picture source "${String(from)}"`));
    return servedPicture(input?.url, PICTURE_HOSTS[from as PictureSource], SOURCE_NAMES[from as PictureSource]);
}
