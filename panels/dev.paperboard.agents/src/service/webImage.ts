// A web image an agent's message shows, fetched here rather than by the
// panel's page: what a message names comes from the model, or from a page it
// read, so the page never asks a host it names for anything. PaperAPI's
// fetchPublic keeps the browser's rule (proxy.ts): it resolves the name
// itself and dials the address it checked, never this computer or its local
// network; each redirect is checked the same way. Only HTTPS, no cookies or
// credentials, a size cap, and only the picture types the chat shows, judged
// by their bytes.

import { fetchPublic, PublicFetchError, type PublicFetchOptions } from "@mileniumhq/paperapi/net";

/** the biggest web image a message shows */
export const WEB_IMAGE_BYTES = 8 * 1024 * 1024;
/** web images fetched at once; past this, one is refused rather than queued */
const MAX_FETCHING = 6;
const ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/gif";

/** a test's own name lookup and dial, to see which checked address each hop reached */
export type WebImageDeps = Pick<PublicFetchOptions, "lookup" | "dial">;

export interface WebImage {
    /** the type its bytes are */
    type: string;
    /** base64 */
    data: string;
}

// the types the chat shows, by the bytes they start with; SVG isn't one (it's a document)
const SNIFF: [string, (b: Buffer) => boolean][] = [
    ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
    ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
    ["image/gif", (b) => b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a"],
    ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
    ["image/avif", (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && ["avif", "avis"].includes(b.subarray(8, 12).toString("latin1"))],
];

let fetching = 0;

/** The image at a web address, fetched under the browser's network rule; throws with why it can't be shown. */
export async function fetchWebImage(raw: unknown, deps: WebImageDeps = {}): Promise<WebImage> {
    // fetchPublic refuses http:// on every hop; the first address is told in the chat's words
    if (typeof raw !== "string" || !/^https:/i.test(raw.trim())) throw new Error("only pictures on https:// addresses are shown");
    if (fetching >= MAX_FETCHING) throw new Error("too many pictures are loading at once; try again in a moment");
    fetching++;
    try {
        const res = await fetchPublic(raw, { maxBytes: WEB_IMAGE_BYTES, accept: ACCEPT, requireHttps: true, ...deps }).catch((e) => {
            throw e instanceof PublicFetchError && e.code === "too-large" ? new Error(`it's over ${WEB_IMAGE_BYTES / 1024 / 1024} MB`) : e;
        });
        if (!/^image\//i.test(res.contentType)) throw new Error(`${new URL(res.url).hostname} didn't send a picture`);
        const bytes = Buffer.from(res.body);
        const type = SNIFF.find(([, is]) => is(bytes))?.[0];
        if (!type) throw new Error("it isn't a PNG, JPEG, GIF, WebP or AVIF picture");
        return { type, data: bytes.toString("base64") };
    } finally {
        fetching--;
    }
}
