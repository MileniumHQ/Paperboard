// The network door for a harness that can't keep its model's code off the
// network by itself. OpenCode's code mode hands the model `fetch`, and no
// permission of OpenCode's governs it (only file: URLs are refused), so code
// the model writes could reach anything this computer can: the daemon, other
// panels, the LAN. OpenCode's runtime sends every request through
// HTTP(S)_PROXY, loopback included, so the harness runs with this proxy and
// the proxy decides.
//
// It lets through: public internet addresses (the providers, web search), and
// the exact origins it's told to (the panel's MCP endpoint, and the base URLs
// the user configured for their own providers). Everything else is refused:
// loopback, private and link-local ranges, carrier NAT, multicast, the
// documentation and benchmark ranges, v4-mapped and translated IPv6.
//
// A name is resolved once, every address it has must pass, and the connection
// goes to the address that was checked, so a name can't answer differently
// the second time (DNS rebinding). Redirects aren't followed here: each hop
// is a new request through the proxy, checked again.
//
// Only the harness can use it: it listens on loopback and wants a secret,
// sent as Proxy-Authorization from the proxy URL's credentials. It's bounded:
// connections at once, the time to open one, and idle time on each.

import { randomBytes, timingSafeEqual } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

const MAX_CONNECTIONS = 64;
const HANDSHAKE_MS = 15_000;
/** a model can think for a while between streamed tokens */
const IDLE_MS = 5 * 60_000;
const USER = "pb";

const blockedV4 = new net.BlockList();
for (const [net4, bits] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
    ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
    ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(net4, bits, "ipv4");

const blockedV6 = new net.BlockList();
for (const [net6, bits] of [
    ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
    ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blockedV6.addSubnet(net6, bits, "ipv6");
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

/** Whether an address is on the public internet: global unicast, none of the special ranges. */
export function isPublicAddress(address: string): boolean {
    const family = net.isIP(address);
    if (family === 4) return !blockedV4.check(address, "ipv4");
    if (family === 6) {
        // global unicast only (2000::/3), minus the special blocks inside it; v4-mapped and translated forms are refused outright
        return globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
    }
    return false;
}

/** "host:port" with the host as the URL spells it, lowercase, IPv6 bracketed; the scheme's port if none. */
export function originKey(url: string): string | null {
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return `${u.hostname.toLowerCase()}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
    } catch {
        return null; // not a URL: nothing to allow
    }
}

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

export interface EgressOptions {
    /** origins let through whatever their address ("http://127.0.0.1:4100/anything"); read on each request */
    allow: () => string[];
    /** for tests: name resolution and the address policy */
    lookup?: Lookup;
    isAllowedAddress?: (address: string) => boolean;
}

export class Egress {
    private sockets = new Set<Duplex>();

    private constructor(
        private server: http.Server,
        private secret: Buffer,
        /** the proxy URL, credentials included: for the harness's environment only */
        readonly url: string,
        private opts: Required<Omit<EgressOptions, "allow">> & Pick<EgressOptions, "allow">,
    ) {}

    static async start(options: EgressOptions): Promise<Egress> {
        const secret = randomBytes(24).toString("hex");
        const server = http.createServer({ requestTimeout: HANDSHAKE_MS, headersTimeout: HANDSHAKE_MS });
        server.maxConnections = MAX_CONNECTIONS;
        await new Promise<void>((ok, fail) => {
            server.once("error", fail);
            server.listen(0, "127.0.0.1", () => {
                server.off("error", fail);
                ok();
            });
        });
        const port = (server.address() as net.AddressInfo).port;
        const lookup: Lookup = options.lookup ?? ((host) => dns.promises.lookup(host, { all: true, verbatim: true }));
        const egress = new Egress(server, Buffer.from(`${USER}:${secret}`), `http://${USER}:${secret}@127.0.0.1:${port}`, {
            allow: options.allow,
            lookup,
            isAllowedAddress: options.isAllowedAddress ?? isPublicAddress,
        });
        server.on("connection", (s) => egress.track(s));
        server.on("request", (req, res) => void egress.forward(req, res));
        server.on("connect", (req, socket, head) => void egress.tunnel(req, socket, head));
        return egress;
    }

    /** Stop listening and cut every connection, tunnels included. */
    close(): Promise<void> {
        for (const s of this.sockets) s.destroy();
        this.sockets.clear();
        return new Promise((ok) => this.server.close(() => ok()));
    }

    private track(s: Duplex) {
        this.sockets.add(s);
        s.once("close", () => this.sockets.delete(s));
        if (s instanceof net.Socket) {
            s.setTimeout(IDLE_MS);
            s.once("timeout", () => s.destroy());
        }
    }

    private authorized(req: http.IncomingMessage): boolean {
        const header = req.headers["proxy-authorization"];
        if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
        const given = Buffer.from(header.slice(6).trim(), "base64");
        return given.length === this.secret.length && timingSafeEqual(given, this.secret);
    }

    /**
     * Where a request may go: the address to connect to, or why not. An allowed origin goes where its name
     * says; anything else must resolve, every address must pass, and the first one is used.
     */
    private async destination(host: string, port: number): Promise<{ address: string } | { refused: string }> {
        const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
        const key = `${net.isIPv6(bare) ? `[${bare}]` : bare}:${port}`;
        if (this.opts.allow().some((o) => originKey(o) === key)) return { address: bare };
        let addresses: { address: string }[];
        try {
            addresses = net.isIP(bare) ? [{ address: bare }] : await this.opts.lookup(bare);
        } catch (e) {
            return { refused: `${host} doesn't resolve (${e instanceof Error ? e.message : String(e)})` };
        }
        if (addresses.length === 0) return { refused: `${host} doesn't resolve` };
        const blocked = addresses.find((a) => !this.opts.isAllowedAddress(a.address));
        if (blocked) return { refused: `${host} is ${blocked.address}, which isn't on the public internet` };
        return { address: addresses[0]!.address };
    }

    private async tunnel(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
        const fail = (status: string, why: string) => {
            console.warn(`[ai] egress refused CONNECT ${req.url}: ${why}`);
            socket.end(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${why}\n`);
        };
        if (!this.authorized(req)) return socket.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="paperboard"\r\nConnection: close\r\n\r\n`);
        const m = /^(\[[0-9a-f:.]+\]|[^:\s[\]]+):(\d{1,5})$/i.exec(req.url ?? "");
        const port = Number(m?.[2]);
        if (!m || !(port >= 1 && port <= 65535)) return fail("400 Bad Request", "CONNECT wants host:port");
        const to = await this.destination(m[1]!, port);
        if ("refused" in to) return fail("403 Forbidden", to.refused);
        if (socket.destroyed) return;
        const upstream = net.connect({ host: to.address, port });
        this.track(upstream);
        const opening = setTimeout(() => upstream.destroy(new Error("timed out")), HANDSHAKE_MS);
        upstream.once("connect", () => {
            clearTimeout(opening);
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
        });
        // either end failing ends both
        upstream.once("error", (e) => {
            clearTimeout(opening);
            if (!socket.destroyed) fail("502 Bad Gateway", e.message);
        });
        upstream.once("close", () => socket.destroy());
        socket.once("close", () => upstream.destroy());
        socket.once("error", () => upstream.destroy());
    }

    private async forward(req: http.IncomingMessage, res: http.ServerResponse) {
        const fail = (status: number, why: string) => {
            if (status === 403) console.warn(`[ai] egress refused ${req.method} ${req.url}: ${why}`);
            if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain", connection: "close" });
            res.end(why + "\n");
        };
        if (!this.authorized(req)) {
            res.writeHead(407, { "proxy-authenticate": 'Basic realm="paperboard"', connection: "close" });
            return res.end();
        }
        let url: URL;
        try {
            url = new URL(req.url ?? "");
        } catch {
            return fail(400, "a proxy request names its whole URL");
        }
        // https goes through CONNECT; a plain request is plain http
        if (url.protocol !== "http:") return fail(400, `${url.protocol} isn't proxied as a plain request`);
        const port = Number(url.port || 80);
        const to = await this.destination(url.hostname, port);
        if ("refused" in to) return fail(403, to.refused);
        const headers: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (HOP_BY_HOP.has(k) || k.startsWith("proxy-")) continue;
            headers[k] = v;
        }
        headers.host = url.host;
        const upstream = http.request({ host: to.address, port, method: req.method, path: url.pathname + url.search, headers, setHost: false, timeout: HANDSHAKE_MS });
        upstream.once("socket", (s) => this.track(s));
        upstream.once("timeout", () => upstream.destroy(new Error("timed out")));
        upstream.once("response", (r) => {
            upstream.setTimeout(0);
            const back: http.OutgoingHttpHeaders = {};
            for (const [k, v] of Object.entries(r.headers)) if (!HOP_BY_HOP.has(k)) back[k] = v;
            res.writeHead(r.statusCode ?? 502, back);
            r.pipe(res);
            r.once("error", () => res.destroy());
        });
        upstream.once("error", (e) => fail(502, e.message));
        res.once("close", () => upstream.destroy());
        req.pipe(upstream);
    }
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade", "proxy-authorization", "proxy-connection", "proxy-authenticate"]);

/** The environment that sends a harness's requests, every one, through the proxy. */
export function proxyEnv(url: string): Record<string, string> {
    return {
        HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url,
        // the service's own environment could exempt hosts; nothing is exempt
        NO_PROXY: "", no_proxy: "",
    };
}
