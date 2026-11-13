// A web image an agent's message shows, fetched here rather than by the
// panel's page: what a message names comes from the model, or from a page it
// read, so the page never asks a host it names for anything. This fetch keeps
// the browser's rule (netPolicy.ts): it resolves the name itself and dials the
// address it checked, never this computer or its local network; each redirect
// is checked the same way. Only HTTPS, no cookies or credentials, a size cap,
// and only the picture types the chat shows, judged by their bytes.

import https from "node:https";
import net from "node:net";
import { resolvePublic } from "./proxy";

/** the biggest web image a message shows */
export const WEB_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
const MAX_URL = 2048;
/** web images fetched at once; past this, one is refused rather than queued */
const MAX_FETCHING = 6;

/** A response, as much of it as this needs. */
export interface WebResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: AsyncIterable<Buffer>;
    /** stops reading it */
    close(): void;
}

export interface WebImageDeps {
    lookup?: (host: string) => Promise<{ address: string }[]>;
    /** one GET of `url`, dialed to `address` (the one checked) and checked as `url`'s host */
    get?: (address: string, url: URL) => Promise<WebResponse>;
}

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
    let url = webAddress(raw);
    if (fetching >= MAX_FETCHING) throw new Error("too many pictures are loading at once; try again in a moment");
    fetching++;
    try {
        for (let hops = 0; ; hops++) {
            const address = await resolvePublic(url.hostname, deps.lookup);
            const res = await (deps.get ?? get)(address, url);
            try {
                if (res.status >= 300 && res.status < 400) {
                    const to = header(res, "location");
                    if (!to) throw new Error(`${url.hostname} sent a redirect with nowhere to go`);
                    if (hops >= MAX_REDIRECTS) throw new Error(`${url.hostname} redirected too many times`);
                    url = webAddress(new URL(to, url).href);
                    continue;
                }
                if (res.status !== 200) throw new Error(`${url.hostname} answered ${res.status}`);
                const declared = Number(header(res, "content-length") ?? NaN);
                if (declared > WEB_IMAGE_BYTES) throw new Error(`it's over ${WEB_IMAGE_BYTES / 1024 / 1024} MB`);
                if (!/^image\//i.test(header(res, "content-type") ?? "")) throw new Error(`${url.hostname} didn't send a picture`);
                const bytes = await readCapped(res.body);
                const type = SNIFF.find(([, is]) => is(bytes))?.[0];
                if (!type) throw new Error("it isn't a PNG, JPEG, GIF, WebP or AVIF picture");
                return { type, data: bytes.toString("base64") };
            } finally {
                res.close();
            }
        }
    } finally {
        fetching--;
    }
}

/** An address a message may show a picture from: HTTPS, with no user name or password in it. */
function webAddress(raw: unknown): URL {
    if (typeof raw !== "string" || raw.length > MAX_URL) throw new Error("that isn't a web address");
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("that isn't a web address");
    }
    if (url.protocol !== "https:") throw new Error("only pictures on https:// addresses are shown");
    if (url.username || url.password) throw new Error("a picture's address can't carry a user name or password");
    return url;
}

function header(res: WebResponse, name: string): string | undefined {
    const v = res.headers[name];
    return Array.isArray(v) ? v[0] : v;
}

async function readCapped(body: AsyncIterable<Buffer>): Promise<Buffer> {
    const parts: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
        total += chunk.length;
        if (total > WEB_IMAGE_BYTES) throw new Error(`it's over ${WEB_IMAGE_BYTES / 1024 / 1024} MB`);
        parts.push(chunk);
    }
    return Buffer.concat(parts);
}

/** A GET to the checked address; the certificate is checked for the URL's host, which the request names too. */
function get(address: string, url: URL): Promise<WebResponse> {
    return new Promise((ok, fail) => {
        const req = https.request({
            host: address,
            port: url.port ? Number(url.port) : 443,
            path: url.pathname + url.search,
            method: "GET",
            // an IP address isn't a server name a certificate is checked by; it's checked as the address
            ...(net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ? {} : { servername: url.hostname }),
            // some sites refuse a request that names no client
            headers: { host: url.host, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif", "user-agent": "Paperboard" },
            agent: false,
            timeout: TIMEOUT_MS,
        });
        req.on("timeout", () => req.destroy(new Error(`${url.hostname} didn't answer`)));
        req.on("error", (e) => fail(new Error(`couldn't load it from ${url.hostname}: ${e.message}`)));
        req.on("response", (res) => {
            res.setTimeout(TIMEOUT_MS, () => res.destroy(new Error(`${url.hostname} stopped sending it`)));
            ok({ status: res.statusCode ?? 0, headers: res.headers, body: res, close: () => res.destroy() });
        });
        req.end();
    });
}
