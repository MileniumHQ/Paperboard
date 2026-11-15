// Pictures from elsewhere for the panel's pages: an add-on's icon, a Steam
// Workshop preview, a wiki's map thumbnail, an image in an add-on's page. A
// page never loads such an address itself. The service fetches it under the
// public-address rule (fetchPublic: public addresses only, size and time
// capped, every redirect checked), from the hosts its source keeps pictures
// on, checks the answer is a picture, and hands the page a data: address.
import { fetchPublic } from "@mileniumhq/paperapi/net";
import { errorMessage } from "@mileniumhq/paperapi";
import { atMost } from "./atMost";
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

/**
 * What a picture's bytes are, by the signature they start with: a server may
 * call a picture application/octet-stream (Steam does), and what it calls a
 * picture may be anything. SVG has no signature; it is taken as the server
 * names it, and an <img> draws it without running anything in it.
 */
function pictureType(body: Uint8Array, declared: string): string | null {
    const text = (from: number, to: number) => String.fromCharCode(...body.subarray(from, to));
    if (text(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
    if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") return "image/gif";
    if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
    if (text(4, 8) === "ftyp" && ["avif", "avis"].includes(text(8, 12))) return "image/avif";
    return declared === "image/svg+xml" ? declared : null;
}
export const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
const FETCH_MS = 20_000;
/** what the pictures kept in memory add up to, at most; the oldest go first */
const KEEP_CHARS = 64 * 1024 * 1024;
// six at a time, as a browser asks a site: a page of a hundred maps asks no harder
const limited = atMost(6);

// by address; a failure is not kept, so the next ask tries again
const kept = new Map<string, string>();
let keptChars = 0;
const inFlight = new Map<string, Promise<string>>();

function keep(key: string, picture: string): void {
    kept.set(key, picture);
    keptChars += picture.length;
    for (const [old, value] of kept) {
        if (keptChars <= KEEP_CHARS) break;
        kept.delete(old);
        keptChars -= value.length;
    }
}

async function fetchPicture(url: URL, trusted: boolean, from: string): Promise<string> {
    let answer;
    try {
        answer = await fetchPublic(url.href, { maxBytes: MAX_PICTURE_BYTES, timeoutMs: FETCH_MS, accept: "image/*", trustedOrigins: trusted ? [url.origin] : [] });
    } catch (err) {
        throw new Error(`Couldn't load the picture from ${from}: ${errorMessage(err)}`);
    }
    const declared = answer.contentType.split(";")[0]!.trim().toLowerCase();
    const type = pictureType(answer.body, declared);
    if (!type) throw new Error(`${from} sent ${declared || "something without a type"} where a picture should be, and it isn't one`);
    return `data:${type};base64,${Buffer.from(answer.body).toString("base64")}`;
}

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
    const key = url.href;
    const have = kept.get(key);
    if (have !== undefined) return Promise.resolve(have);
    let pending = inFlight.get(key);
    if (!pending) {
        const trusted = hosts !== null && url.hostname === "127.0.0.1";
        pending = limited(() => fetchPicture(url, trusted, from))
            .then((picture) => (keep(key, picture), picture))
            .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return pending;
}

/** The panel's picture call: `url` from `from`, one of PICTURE_HOSTS' sources. */
export function pictureCall(input: { from?: unknown; url?: unknown } | undefined): Promise<string> {
    const from = input?.from;
    if (typeof from !== "string" || !Object.hasOwn(PICTURE_HOSTS, from)) return Promise.reject(new Error(`There is no picture source "${String(from)}"`));
    return servedPicture(input?.url, PICTURE_HOSTS[from as PictureSource], SOURCE_NAMES[from as PictureSource]);
}
