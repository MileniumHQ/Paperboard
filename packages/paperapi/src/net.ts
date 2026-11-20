// Fetching a web address that came from untrusted input (a chat message, a
// flow's input, a model's answer) in a panel's service, under the
// public-address rule: the public internet, never this computer or the
// network it sits on. The name is resolved here and the connection dialed to
// the address that was checked, so a name's owner can't answer a second
// lookup differently (DNS rebinding). Every redirect is checked the same way,
// and the body is bounded in bytes and the whole fetch in time. Each refusal
// throws a PublicFetchError saying why.
//
// Service-only (it uses Node's network modules): import it from
// "@mileniumhq/paperapi/net", never in a page.

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import { errorMessage } from "./errors";
import { LimitedQueue } from "./serialQueue";

// ─── which addresses are public ─────────────────────────────────────────────

const V4: [string, number][] = [
    ["0.0.0.0", 8], // this network, unspecified
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // carrier-grade NAT, and some clouds' metadata (100.100.100.200)
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // link-local, cloud metadata
    ["172.16.0.0", 12],
    ["192.0.0.0", 24], // IETF protocol assignments (192.0.0.192 is a metadata endpoint)
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, broadcast
];
const V4_HOSTS = ["168.63.129.16"]; // Azure's platform endpoint, outside the ranges above

const V6: [string, number][] = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48], // local-use NAT64
    ["100::", 64], // discard
    ["2001::", 32], // Teredo: an IPv4 address in disguise
    ["2001:db8::", 32], // documentation
    ["fc00::", 7], // unique local
    ["fd00:ec2::", 32], // AWS metadata
    ["fe80::", 10], // link-local
    ["fec0::", 10], // site-local (deprecated, still routable on some networks)
    ["ff00::", 8], // multicast
];

const blocked = new net.BlockList();
for (const [a, p] of V4) blocked.addSubnet(a, p, "ipv4");
for (const a of V4_HOSTS) blocked.addAddress(a, "ipv4");
for (const [a, p] of V6) blocked.addSubnet(a, p, "ipv6");

/** The IPv4 address an IPv6 one carries: mapped, translated, compatible, NAT64 (64:ff9b::/96) and 6to4 (2002::/16). */
function embeddedV4(ip: string): string | null {
    const words = expandV6(ip);
    if (!words) return null;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zero = (from: number, to: number) => words.slice(from, to).every((w) => w === 0);
    // ::ffff:a.b.c.d, ::ffff:0:a.b.c.d (translated), ::a.b.c.d (compatible; :: and ::1 are matched as themselves)
    if (zero(0, 5) && words[5] === 0xffff) return v4(words[6]!, words[7]!);
    if (zero(0, 4) && words[4] === 0xffff && words[5] === 0) return v4(words[6]!, words[7]!);
    if (zero(0, 6) && (words[6]! > 0 || words[7]! > 1)) return v4(words[6]!, words[7]!);
    if (words[0] === 0x64 && words[1] === 0xff9b && zero(2, 6)) return v4(words[6]!, words[7]!);
    if (words[0] === 0x2002) return v4(words[1]!, words[2]!);
    return null;
}

function expandV6(ip: string): number[] | null {
    if (!net.isIPv6(ip)) return null;
    let s = ip.toLowerCase().split("%")[0]!;
    // a trailing dotted quad becomes two words
    const quad = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (quad) {
        const [a, b, c, d] = quad.slice(1).map(Number) as [number, number, number, number];
        s = s.slice(0, quad.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    }
    const [head, tail] = s.split("::") as [string, string | undefined];
    const h = head ? head.split(":") : [];
    const t = tail ? tail.split(":") : [];
    const fill = tail !== undefined ? 8 - h.length - t.length : 0;
    const words = [...h, ...Array(Math.max(0, fill)).fill("0"), ...t].map((w) => parseInt(w, 16));
    return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}

/** This computer's own addresses: a server bound to 0.0.0.0 answers on them just as it does on loopback. */
function ownAddresses(): Set<string> {
    const own = new Set<string>();
    for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) own.add(i.address.toLowerCase().split("%")[0]!);
    return own;
}

/**
 * Why an IP address isn't a public one (loopback, private, link-local,
 * carrier-grade NAT, multicast, reserved, a cloud's metadata endpoint, an
 * IPv6 address carrying one of those, or this computer's own), or null when
 * it is. Anything that isn't an IP address is refused.
 */
export function publicAddressRefusal(ip: string): string | null {
    const bare = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
    const family = net.isIP(bare);
    if (family === 0) return "not an IP address";
    if (family === 6) {
        const v4 = embeddedV4(bare);
        if (v4 !== null) return publicAddressRefusal(v4);
    }
    if (blocked.check(bare, family === 4 ? "ipv4" : "ipv6")) return "a private or local address";
    // read each time: addresses change as networks come and go
    if (ownAddresses().has(bare)) return "this computer's own address";
    return null;
}

// ─── fetching ───────────────────────────────────────────────────────────────

export type PublicFetchErrorCode =
    /** not an http or https address this fetches */
    | "invalid-url"
    /** the address, or one it redirected to, is on this computer or its local network */
    | "refused"
    /** the name didn't resolve, or the server couldn't be reached */
    | "unreachable"
    /** the server answered with an error, or a redirect that goes nowhere or too far */
    | "bad-response"
    /** the body is bigger than maxBytes */
    | "too-large"
    /** the whole fetch took longer than timeoutMs */
    | "timeout";

export class PublicFetchError extends Error {
    constructor(
        readonly code: PublicFetchErrorCode,
        message: string,
        /** the HTTP status of the answer that failed it; set for a "bad-response" that is an error answer, otherwise undefined */
        readonly status?: number,
    ) {
        super(message);
        this.name = "PublicFetchError";
    }
}

export interface PublicFetchOptions {
    /** the most bytes the body may be; a bigger one is refused, read no further than this */
    maxBytes: number;
    /** the whole fetch, redirects and body included (default 15 s) */
    timeoutMs?: number;
    /** redirects followed, each checked like the first address (default 3) */
    maxRedirects?: number;
    /** the request's Accept header (default any type) */
    accept?: string;
    /** how a name is resolved (default the system's resolver) */
    lookup?: (host: string) => Promise<{ address: string }[]>;
    /** only https addresses, the first and every redirect; an http one fails as invalid-url */
    requireHttps?: boolean;
    /**
     * How one GET is made (default Node's http and https). A test passes its
     * own to see which address each hop dialed, or to reach a server whose
     * certificate it made.
     */
    dial?: PublicFetchDial;
}

/** A server's answer, as much of it as fetchPublic reads. */
export interface PublicFetchAnswer {
    status: number;
    /** the status line's words, such as "Not Found", or "" */
    statusText: string;
    /** by lower-case name */
    headers: Record<string, string | string[] | undefined>;
    body: AsyncIterable<Uint8Array>;
    /** stops reading the body and drops the connection */
    close(): void;
}

/**
 * One GET of `url`, dialed to `address` (the one checked, never a second
 * lookup of the name). The request names `url`'s host, and an https
 * certificate is checked for it. Past `signal`, the connection and the body
 * being read from it end.
 */
export type PublicFetchDial = (address: string, url: URL, request: { accept: string; signal: AbortSignal }) => Promise<PublicFetchAnswer>;

export interface PublicFetchResponse {
    /** the address the body came from, after redirects */
    url: string;
    status: number;
    /** the Content-Type the server sent, or "" */
    contentType: string;
    body: Uint8Array;
}

/**
 * Where a test names its own servers (on loopback, or a stand-in name for
 * it), which fetchPublic then reaches without the public-address rule: their
 * origins, comma-separated ("http://127.0.0.1:8080"). A test sets it in its
 * own process, or for the daemon whose services it runs. No caller can pass
 * one, and no shipped code names it: a panel always fetches under the rule.
 */
export const TEST_TRUSTED_ORIGINS_ENV = "PAPERAPI_TEST_TRUSTED_ORIGINS";

const testTrustedOrigins = (): Set<string> =>
    new Set((process.env[TEST_TRUSTED_ORIGINS_ENV] ?? "").split(",").map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin));

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REDIRECTS = 3;
const MAX_URL = 4096;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * A GET of an http or https address under the public-address rule; see the
 * module comment. Resolves with a 2xx answer's body, and throws a
 * PublicFetchError saying why for anything else.
 */
export async function fetchPublic(raw: unknown, options: PublicFetchOptions): Promise<PublicFetchResponse> {
    const { maxBytes } = options;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error(`fetchPublic needs maxBytes as a whole number of bytes, got ${String(maxBytes)}`);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? DEFAULT_REDIRECTS;
    const trusted = testTrustedOrigins();
    const lookup = options.lookup ?? ((h: string) => dns.lookup(h, { all: true, verbatim: true }));
    const dial = options.dial ?? get;
    const httpsOnly = options.requireHttps === true;
    let url = webAddress(raw, httpsOnly);
    // the deadline covers every step: each one ends with this error once it passes
    const deadline = new AbortController();
    const late = () => new PublicFetchError("timeout", `${url.host} took longer than ${seconds(timeoutMs)} to answer`);
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    const inTime = <T>(work: Promise<T>) =>
        new Promise<T>((ok, fail) => {
            const onLate = () => fail(late());
            deadline.signal.addEventListener("abort", onLate, { once: true });
            work.then(ok, fail).finally(() => deadline.signal.removeEventListener("abort", onLate));
        });
    try {
        for (let hops = 0; ; hops++) {
            const address = await inTime(resolve(url, lookup, !trusted.has(url.origin)));
            const res = await inTime(dial(address, url, { accept: options.accept ?? "*/*", signal: deadline.signal }));
            try {
                const { status } = res;
                if (REDIRECTS.has(status)) {
                    const to = header(res, "location");
                    if (!to) throw new PublicFetchError("bad-response", `${url.host} sent a redirect with nowhere to go`);
                    if (hops >= maxRedirects) throw new PublicFetchError("bad-response", `${url.host} redirected more than ${maxRedirects} times`);
                    url = webAddress(new URL(to, url).href, httpsOnly);
                    continue;
                }
                if (status < 200 || status > 299) throw new PublicFetchError("bad-response", `${url.host} answered ${status}${res.statusText ? ` ${res.statusText}` : ""}`, status);
                const declared = Number(header(res, "content-length") ?? NaN);
                if (declared > maxBytes) throw tooLarge(url, maxBytes);
                const body = await inTime(readCapped(res.body, url, maxBytes));
                return { url: url.href, status, contentType: header(res, "content-type") ?? "", body };
            } finally {
                res.close();
            }
        }
    } finally {
        clearTimeout(timer);
    }
}

/** The default dial: Node's http and https. */
const get: PublicFetchDial = (address, url, { accept, signal }) => {
    return new Promise((ok, fail) => {
        const tls = url.protocol === "https:";
        const req = (tls ? https : http).request({
            host: address,
            port: url.port ? Number(url.port) : tls ? 443 : 80,
            path: url.pathname + url.search,
            method: "GET",
            // an IP address isn't a server name a certificate is checked by; it's checked as the address
            ...(tls && !net.isIP(bareHost(url)) ? { servername: url.hostname } : {}),
            // some servers refuse a request that names no client
            headers: { host: url.host, accept, "user-agent": "Paperboard" },
            agent: false,
        });
        // past the deadline the connection, and the body being read from it, end
        const stop = () => req.destroy();
        signal.addEventListener("abort", stop, { once: true });
        req.on("close", () => signal.removeEventListener("abort", stop));
        req.on("error", (e) => fail(new PublicFetchError("unreachable", `Couldn't reach ${url.host}: ${e.message}`)));
        req.on("response", (res) =>
            ok({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: res.headers, body: res, close: () => res.destroy() }),
        );
        req.end();
    });
};

/** An address this fetches: http or https (only https when `httpsOnly`), with no user name or password in it. */
function webAddress(raw: unknown, httpsOnly: boolean): URL {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) throw new PublicFetchError("invalid-url", "There's no web address");
    if (text.length > MAX_URL) throw new PublicFetchError("invalid-url", `A web address is at most ${MAX_URL} characters`);
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw new PublicFetchError("invalid-url", `"${text.slice(0, 200)}" isn't a web address`);
    }
    if (httpsOnly && url.protocol !== "https:") throw new PublicFetchError("invalid-url", `Only https addresses are fetched, not ${url.protocol}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new PublicFetchError("invalid-url", `Only http and https addresses are fetched, not ${url.protocol}`);
    if (url.username || url.password) throw new PublicFetchError("invalid-url", "A web address can't carry a user name or password");
    return url;
}

function bareHost(url: URL): string {
    return url.hostname.replace(/^\[|\]$/g, "");
}

/** The address to dial for `url`'s host: the first one it resolves to that the rule allows (`checked`), or why there is none. */
async function resolve(url: URL, lookup: NonNullable<PublicFetchOptions["lookup"]>, checked: boolean): Promise<string> {
    const host = bareHost(url);
    if (net.isIP(host)) {
        const why = checked ? publicAddressRefusal(host) : null;
        if (why) throw new PublicFetchError("refused", `${url.host} is ${why}`);
        return host;
    }
    let found: { address: string }[];
    try {
        found = await lookup(host);
    } catch (err) {
        throw new PublicFetchError("unreachable", `Couldn't find ${url.hostname}: ${errorMessage(err)}`);
    }
    if (!found.length) throw new PublicFetchError("unreachable", `Couldn't find ${url.hostname}`);
    const allowed = checked ? found.filter((a) => publicAddressRefusal(a.address) === null) : found;
    if (!allowed.length) throw new PublicFetchError("refused", `${url.hostname} is on this computer or its local network (${found[0]!.address})`);
    return allowed[0]!.address;
}

function header(res: PublicFetchAnswer, name: string): string | undefined {
    const v = res.headers[name];
    return Array.isArray(v) ? v[0] : v;
}

async function readCapped(body: AsyncIterable<Uint8Array>, url: URL, maxBytes: number): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body) {
        total += chunk.byteLength;
        if (total > maxBytes) throw tooLarge(url, maxBytes);
        parts.push(chunk);
    }
    return new Uint8Array(Buffer.concat(parts));
}

function tooLarge(url: URL, maxBytes: number): PublicFetchError {
    return new PublicFetchError("too-large", `The file at ${url.host} is over ${size(maxBytes)}`);
}

function size(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${+(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} bytes`;
}

function seconds(ms: number): string {
    return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

// ─── pictures for a page ────────────────────────────────────────────────────

export interface PictureFetchOptions {
    /** the most bytes one picture may be */
    maxBytes: number;
    /** each fetch, redirects included (default 15 s) */
    timeoutMs?: number;
    /** redirects followed, each checked like the first address (default 3) */
    maxRedirects?: number;
    /** what the pictures kept in memory add up to, in characters of their data: addresses (default 16 M); the oldest go first */
    keepChars?: number;
    /** pictures fetched at once (default 6, as a browser asks a site): a page of a hundred asks no harder */
    atOnce?: number;
}

export interface PictureRequest {
    /** the source, as a failure names it: "Couldn't load the picture from <from>: …" */
    from: string;
}

/** The picture at an address as a data: address, for a page to show. Throws why it couldn't be fetched, or isn't a picture. */
export type PictureFetch = (url: URL, request: PictureRequest) => Promise<string>;

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
    if (text(4, 8) === "ftyp" && ["avif", "avis"].includes(text(8, 12))) return "image/avif";
    if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
    return declared === "image/svg+xml" ? declared : null;
}

/**
 * Pictures from elsewhere, for a service to hand its pages: a page never
 * loads an address someone else chose, not even an image. Each is fetched
 * with fetchPublic (public addresses only, size and time capped, every
 * redirect checked), its type is read from its bytes, and it comes back as a
 * data: address. Answers are kept by address, within `keepChars`, and asks
 * for one being fetched share its fetch; a failure is not kept, so the next
 * ask tries again. Which addresses a source may name (its hosts) is the
 * caller's to check first.
 */
export function createPictureFetch(options: PictureFetchOptions): PictureFetch {
    const keepChars = options.keepChars ?? 16 * 1024 * 1024;
    const line = new LimitedQueue(options.atOnce ?? 6);
    // by address, oldest first
    const kept = new Map<string, string>();
    let keptChars = 0;
    const inFlight = new Map<string, Promise<string>>();

    const keep = (key: string, picture: string) => {
        kept.set(key, picture);
        keptChars += picture.length;
        for (const [old, value] of kept) {
            if (keptChars <= keepChars) break;
            kept.delete(old);
            keptChars -= value.length;
        }
    };

    const fetchPicture = async (href: string, request: PictureRequest): Promise<string> => {
        let answer: PublicFetchResponse;
        try {
            answer = await fetchPublic(href, {
                maxBytes: options.maxBytes,
                timeoutMs: options.timeoutMs,
                maxRedirects: options.maxRedirects,
                accept: "image/*",
            });
        } catch (err) {
            // the fetch's own error stays as the cause, so a caller can tell a missing picture (status 404) from a failure
            throw new Error(`Couldn't load the picture from ${request.from}: ${errorMessage(err)}`, { cause: err });
        }
        const declared = answer.contentType.split(";")[0]!.trim().toLowerCase();
        const type = pictureType(answer.body, declared);
        if (!type) throw new Error(`${request.from} sent ${declared || "something without a type"} where a picture should be, and it isn't one`);
        return `data:${type};base64,${Buffer.from(answer.body).toString("base64")}`;
    };

    return (url, request) => {
        const key = url.href;
        const have = kept.get(key);
        if (have !== undefined) return Promise.resolve(have);
        let pending = inFlight.get(key);
        if (!pending) {
            pending = line
                .run(() => fetchPicture(key, request))
                .then((picture) => {
                    keep(key, picture);
                    return picture;
                })
                .finally(() => inFlight.delete(key));
            inFlight.set(key, pending);
        }
        return pending;
    };
}
