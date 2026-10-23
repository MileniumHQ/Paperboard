// The agent's browser reaches the web only through this proxy, which the
// service runs on loopback. It resolves every name itself and dials only an
// address netPolicy allows, the one it checked (there is no second lookup a
// name's owner could answer differently). The browser is told to send
// loopback through it too (`--proxy-bypass-list=<-loopback>`), so this
// machine, its local network and their services are refused here, by name
// or by number.
//
// HTTPS and WebSockets arrive as CONNECT tunnels, plain HTTP as requests in
// absolute form. Connections, header time and idle time are bounded; piping
// keeps backpressure, and a failure on either side ends both.

import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { refusal } from "./netPolicy";

const MAX_CONNECTIONS = 256;
const HEADERS_MS = 10_000;
const IDLE_MS = 2 * 60_000;
const DIAL_MS = 15_000;
const HOP_HEADERS = ["proxy-connection", "proxy-authorization", "connection", "keep-alive", "te", "trailer", "upgrade"];

export interface Proxy {
    port: number;
    close(): Promise<void>;
}

/** The address to dial for a host, or why there is none. */
export async function resolvePublic(host: string, lookup: (h: string) => Promise<{ address: string }[]> = defaultLookup): Promise<string> {
    const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (net.isIP(bare)) {
        const why = refusal(bare);
        if (why) throw new Refused(`${host} is ${why}`);
        return bare;
    }
    let found: { address: string }[];
    try {
        found = await lookup(bare);
    } catch {
        throw new Unreachable(`couldn't find ${host}`);
    }
    const allowed = found.map((a) => a.address).filter((a) => refusal(a) === null);
    if (allowed.length) return allowed[0]!;
    throw new Refused(found.length ? `${host} is on this computer or its local network` : `couldn't find ${host}`);
}

const defaultLookup = (h: string) => dns.lookup(h, { all: true, verbatim: true });

class Refused extends Error {}
class Unreachable extends Error {}

function target(authority: string): { host: string; port: number } | null {
    const m = authority.match(/^(\[[0-9a-fA-F:.]+\]|[^:\s/]+):(\d{1,5})$/);
    if (!m) return null;
    const port = Number(m[2]);
    return port >= 1 && port <= 65535 ? { host: m[1]!, port } : null;
}

export async function startProxy(o: { lookup?: (h: string) => Promise<{ address: string }[]> } = {}): Promise<Proxy> {
    const lookup = o.lookup ?? defaultLookup;
    const sockets = new Set<net.Socket>();
    const server = http.createServer();
    server.headersTimeout = HEADERS_MS;
    server.requestTimeout = 0; // a download can take as long as it takes; idle time is what's bounded
    server.keepAliveTimeout = 5_000;

    server.on("connection", (s: net.Socket) => {
        if (sockets.size >= MAX_CONNECTIONS) {
            s.destroy();
            return;
        }
        sockets.add(s);
        s.setTimeout(IDLE_MS, () => s.destroy());
        s.once("close", () => sockets.delete(s));
    });

    const dial = async (host: string, port: number): Promise<net.Socket> => {
        const address = await resolvePublic(host, lookup);
        return await new Promise<net.Socket>((ok, fail) => {
            const up = net.connect({ host: address, port });
            const t = setTimeout(() => {
                up.destroy();
                fail(new Unreachable(`${host} didn't answer`));
            }, DIAL_MS);
            up.once("connect", () => {
                clearTimeout(t);
                up.removeAllListeners("error");
                ok(up);
            });
            up.once("error", () => {
                clearTimeout(t);
                up.destroy();
                fail(new Unreachable(`couldn't connect to ${host}`));
            });
        });
    };

    const status = (e: unknown) => (e instanceof Refused ? 403 : 502);
    const reason = (e: unknown) => (e instanceof Refused || e instanceof Unreachable ? e.message : "the connection failed");

    // HTTPS, WebSockets: a tunnel to a checked address
    server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
        const t = target(req.url ?? "");
        client.on("error", () => client.destroy());
        if (!t) {
            client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
        }
        dial(t.host, t.port).then(
            (up) => {
                if (client.destroyed) {
                    up.destroy();
                    return;
                }
                client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                if (head.length) up.write(head);
                up.setTimeout(IDLE_MS, () => up.destroy());
                const end = () => {
                    up.destroy();
                    client.destroy();
                };
                up.on("error", end).on("close", end);
                client.on("close", end);
                up.pipe(client);
                client.pipe(up);
            },
            (e) => {
                const code = status(e);
                client.end(`HTTP/1.1 ${code} ${code === 403 ? "Forbidden" : "Bad Gateway"}\r\nContent-Type: text/plain\r\n\r\n${reason(e)}`);
            },
        );
    });

    // plain HTTP: forwarded to a checked address, the Host header as the browser sent it
    server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
        let url: URL;
        try {
            url = new URL(req.url ?? "");
        } catch {
            res.statusCode = 400;
            res.end("only proxy requests");
            return;
        }
        if (url.protocol !== "http:") {
            res.writeHead(400).end("only http through here");
            return;
        }
        const port = url.port ? Number(url.port) : 80;
        const headers = { ...req.headers };
        for (const h of HOP_HEADERS) delete headers[h];
        resolvePublic(url.hostname, lookup).then(
            (address) => {
                const up = http.request({ host: address, port, method: req.method, path: url.pathname + url.search, headers, setHost: false, timeout: DIAL_MS });
                up.on("response", (r) => {
                    up.setTimeout(IDLE_MS);
                    const out = { ...r.headers };
                    for (const h of HOP_HEADERS) delete out[h];
                    res.writeHead(r.statusCode ?? 502, out);
                    r.pipe(res);
                    r.on("error", () => res.destroy());
                });
                up.on("timeout", () => up.destroy(new Unreachable(`${url.hostname} didn't answer`)));
                up.on("error", (e) => {
                    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" }).end(reason(e));
                    else res.destroy();
                });
                res.on("close", () => up.destroy());
                req.pipe(up);
            },
            // the page the agent sees in place of the site, so it reads why
            (e) => res.writeHead(status(e), { "Content-Type": "text/plain" }).end(`This browser can't open that: ${reason(e)}. It reaches the internet only.`),
        );
    });

    // an HTTP upgrade sent without CONNECT: browsers tunnel instead, so nothing needs this
    server.on("upgrade", (_req: http.IncomingMessage, s: net.Socket) => s.end("HTTP/1.1 501 Not Implemented\r\n\r\n"));

    await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", () => ok());
    });
    return {
        port: (server.address() as AddressInfo).port,
        close: async () => {
            for (const s of sockets) s.destroy();
            await new Promise<void>((ok) => server.close(() => ok()));
        },
    };
}
