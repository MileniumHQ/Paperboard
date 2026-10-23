// The egress proxy a harness's requests go through: the address policy, and
// the proxy itself over real sockets on loopback. "Public" is injected where
// a test needs somewhere to actually connect; the default policy is tested
// on its own.
import { afterEach, describe, expect, it } from "bun:test";
import http from "node:http";
import net from "node:net";
import { Egress, isPublicAddress, originKey, proxyEnv, type Lookup } from "../src/service/egress";

const open: { close(): unknown }[] = [];
afterEach(async () => {
    for (const o of open.splice(0)) await o.close();
});

async function upstream(): Promise<{ port: number; hits: string[] }> {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
        hits.push(`${req.method} ${req.url} host=${req.headers.host} proxyauth=${req.headers["proxy-authorization"] ?? "-"}`);
        res.end("upstream-body");
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    open.push({ close: () => new Promise((ok) => server.close(ok)) });
    server.on("connection", (s) => open.push({ close: () => s.destroy() }));
    return { port: (server.address() as net.AddressInfo).port, hits };
}

async function proxy(o: { allow?: string[]; lookup?: Lookup; isAllowedAddress?: (a: string) => boolean } = {}) {
    const egress = await Egress.start({ allow: () => o.allow ?? [], lookup: o.lookup, isAllowedAddress: o.isAllowedAddress });
    open.push(egress);
    const u = new URL(egress.url);
    return { egress, port: Number(u.port), auth: "Basic " + Buffer.from(`${u.username}:${u.password}`).toString("base64") };
}

/** A plain proxied request: status and body. */
function get(proxyPort: number, url: string, auth?: string): Promise<{ status: number; body: string }> {
    return new Promise((ok, fail) => {
        const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers: auth ? { "proxy-authorization": auth } : {} }, (res) => {
            let body = "";
            res.on("data", (d) => (body += d));
            res.on("end", () => ok({ status: res.statusCode!, body }));
        });
        req.on("error", fail);
        req.end();
    });
}

/** A CONNECT: the status line, and then, if it opened, a plain GET through the tunnel. */
function connect(proxyPort: number, target: string, auth?: string): Promise<{ status: number; through?: string }> {
    return new Promise((ok, fail) => {
        const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: target, headers: auth ? { "proxy-authorization": auth } : {} });
        req.on("connect", (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                return ok({ status: res.statusCode! });
            }
            let through = "";
            socket.on("data", (d) => (through += d));
            socket.on("end", () => ok({ status: 200, through }));
            socket.write(`GET /tunneled HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        });
        req.on("error", fail);
        req.end();
    });
}

describe("the address policy", () => {
    it("lets public addresses through", () => {
        for (const a of ["8.8.8.8", "1.1.1.1", "142.250.72.14", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) expect(isPublicAddress(a)).toBe(true);
    });

    it("refuses loopback, private, link-local, carrier NAT, multicast, reserved and documentation ranges", () => {
        for (const a of [
            "127.0.0.1", "127.255.255.254", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "198.18.0.1",
        ]) expect([a, isPublicAddress(a)]).toEqual([a, false]);
    });

    it("refuses IPv6 loopback, unique-local, link-local, multicast, and v4 dressed as v6", () => {
        for (const a of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1", "0200::1"]) {
            expect([a, isPublicAddress(a)]).toEqual([a, false]);
        }
    });

    it("refuses what isn't an address", () => {
        expect(isPublicAddress("localhost")).toBe(false);
        expect(isPublicAddress("2130706433")).toBe(false);
    });

    it("keys origins the way the proxy sees them", () => {
        expect(originKey("http://127.0.0.1:4100/mcp")).toBe("127.0.0.1:4100");
        expect(originKey("https://Vertex.example.com/v1")).toBe("vertex.example.com:443");
        expect(originKey("http://[::1]:9/")).toBe("[::1]:9");
        expect(originKey("file:///etc/passwd")).toBeNull();
        expect(originKey("not a url")).toBeNull();
    });
});

describe("the egress proxy", () => {
    it("wants its secret: without it, 407 and nothing goes out", async () => {
        const up = await upstream();
        const p = await proxy({ allow: [`http://127.0.0.1:${up.port}`] });
        expect((await get(p.port, `http://127.0.0.1:${up.port}/x`)).status).toBe(407);
        expect((await get(p.port, `http://127.0.0.1:${up.port}/x`, "Basic " + Buffer.from("pb:wrong").toString("base64"))).status).toBe(407);
        expect((await connect(p.port, `127.0.0.1:${up.port}`)).status).toBe(407);
        expect(up.hits).toEqual([]);
    });

    it("refuses loopback however it's spelled, by plain request or CONNECT", async () => {
        const up = await upstream();
        // the default policy, and the real resolver: localhost is loopback
        const p = await proxy();
        for (const host of ["127.0.0.1", "localhost", "127.1", "2130706433", "0.0.0.0", "[::1]"]) {
            expect([host, (await get(p.port, `http://${host}:${up.port}/x`, p.auth)).status]).toEqual([host, 403]);
            expect([host, (await connect(p.port, `${host}:${up.port}`, p.auth)).status]).toEqual([host, 403]);
        }
        expect(up.hits).toEqual([]);
    });

    it("lets an allowed origin through, exactly that origin, without passing its secret on", async () => {
        const up = await upstream();
        const other = await upstream();
        const p = await proxy({ allow: [`http://127.0.0.1:${up.port}/mcp`] });
        expect(await get(p.port, `http://127.0.0.1:${up.port}/mcp?a=1`, p.auth)).toEqual({ status: 200, body: "upstream-body" });
        expect(up.hits).toEqual([`GET /mcp?a=1 host=127.0.0.1:${up.port} proxyauth=-`]);
        expect((await get(p.port, `http://127.0.0.1:${other.port}/mcp`, p.auth)).status).toBe(403);
        expect(other.hits).toEqual([]);
    });

    it("connects to the address it checked: a name resolves once, and any non-public answer refuses it", async () => {
        const up = await upstream();
        let lookups = 0;
        // "public.test" resolves to the test server, which this policy calls public; "rebind.test" also has a private answer
        const lookup: Lookup = async (host) => {
            lookups++;
            if (host === "public.test") return [{ address: "127.0.0.1", family: 4 }];
            if (host === "rebind.test") return [{ address: "127.0.0.1", family: 4 }, { address: "10.0.0.5", family: 4 }];
            throw new Error("ENOTFOUND");
        };
        const p = await proxy({ lookup, isAllowedAddress: (a) => a === "127.0.0.1" });
        expect(await get(p.port, `http://public.test:${up.port}/page`, p.auth)).toEqual({ status: 200, body: "upstream-body" });
        expect(up.hits).toEqual([`GET /page host=public.test:${up.port} proxyauth=-`]);
        expect(lookups).toBe(1);
        const tunneled = await connect(p.port, `public.test:${up.port}`, p.auth);
        expect(tunneled.status).toBe(200);
        expect(tunneled.through).toContain("upstream-body");
        expect((await get(p.port, `http://rebind.test:${up.port}/x`, p.auth)).status).toBe(403);
        expect((await connect(p.port, `rebind.test:${up.port}`, p.auth)).status).toBe(403);
        expect((await get(p.port, `http://nowhere.test:${up.port}/x`, p.auth)).status).toBe(403);
    });

    it("logs a refused destination once, however often it's asked for", async () => {
        const p = await proxy();
        const warned: string[] = [];
        const warn = console.warn;
        console.warn = (...a: unknown[]) => void warned.push(a.join(" "));
        try {
            for (let i = 0; i < 3; i++) {
                expect((await get(p.port, "http://127.0.0.1:11434/api/tags", p.auth)).status).toBe(403);
                expect((await connect(p.port, "127.0.0.1:8000", p.auth)).status).toBe(403);
            }
        } finally {
            console.warn = warn;
        }
        expect(warned.length).toBe(2);
        expect(warned[0]).toContain("127.0.0.1:11434");
        expect(warned[1]).toContain("127.0.0.1:8000");
    });

    it("closing cuts open tunnels", async () => {
        const up = await upstream();
        const p = await proxy({ lookup: async () => [{ address: "127.0.0.1", family: 4 }], isAllowedAddress: () => true });
        const closed = new Promise<boolean>((ok, fail) => {
            const req = http.request({ host: "127.0.0.1", port: p.port, method: "CONNECT", path: `public.test:${up.port}`, headers: { "proxy-authorization": p.auth } });
            req.on("connect", (_res, socket) => {
                socket.on("close", () => ok(true));
                void p.egress.close();
            });
            req.on("error", fail);
            req.end();
        });
        expect(await closed).toBe(true);
    });

    it("its environment sends everything through it, with nothing exempt", () => {
        const env = proxyEnv("http://pb:s@127.0.0.1:1");
        for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) expect(env[k]).toBe("http://pb:s@127.0.0.1:1");
        expect(env.NO_PROXY).toBe("");
        expect(env.no_proxy).toBe("");
    });
});
