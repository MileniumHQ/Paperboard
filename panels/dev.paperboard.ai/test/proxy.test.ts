// The agent's browser reaches the public web and nothing on this machine or its network.

import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { embeddedV4, refusal } from "../src/service/netPolicy";
import { resolvePublic, startProxy, type Proxy } from "../src/service/proxy";

describe("which addresses the browser may reach", () => {
    test("public addresses are allowed", () => {
        for (const ip of ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "8.8.8.8"]) expect(refusal(ip)).toBeNull();
    });

    test("loopback, private, link-local, CGNAT, multicast and metadata addresses are refused", () => {
        const refused = [
            "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.10",
            "169.254.169.254", "100.64.0.1", "100.100.100.200", "192.0.0.192", "168.63.129.16", "224.0.0.251", "255.255.255.255",
            "::1", "::", "fe80::1", "fd12:3456::1", "fc00::1", "ff02::fb", "fd00:ec2::254",
        ];
        for (const ip of refused) expect(refusal(ip), ip).not.toBeNull();
    });

    test("IPv6 forms that carry a private IPv4 address are judged by it", () => {
        expect(embeddedV4("::ffff:127.0.0.1")).toBe("127.0.0.1");
        expect(embeddedV4("::ffff:7f00:1")).toBe("127.0.0.1");
        expect(embeddedV4("64:ff9b::a00:1")).toBe("10.0.0.1");
        expect(embeddedV4("2002:c0a8:0101::1")).toBe("192.168.1.1");
        for (const ip of ["::ffff:127.0.0.1", "::ffff:192.168.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "::ffff:0:10.1.2.3"]) expect(refusal(ip), ip).not.toBeNull();
        expect(refusal("::ffff:1.1.1.1")).toBeNull();
    });

    test("this computer's own addresses are refused, whatever network it's on", () => {
        const own = Object.values(os.networkInterfaces()).flatMap((l) => l ?? []).map((i) => i.address);
        expect(own.length).toBeGreaterThan(0);
        for (const ip of own) expect(refusal(ip), ip).not.toBeNull();
    });

    test("a name is refused when every address it has is local, and dialed at a public one otherwise", async () => {
        const fake = (map: Record<string, string[]>) => async (h: string) => (map[h] ?? []).map((address) => ({ address }));
        await expect(resolvePublic("sneaky.example", fake({ "sneaky.example": ["127.0.0.1", "10.1.1.1"] }))).rejects.toThrow("local network");
        expect(await resolvePublic("mixed.example", fake({ "mixed.example": ["192.168.0.2", "93.184.215.14"] }))).toBe("93.184.215.14");
        await expect(resolvePublic("[::1]")).rejects.toThrow("private or local");
        await expect(resolvePublic("nothing.example", fake({}))).rejects.toThrow("couldn't find");
    });
});

describe("the proxy", () => {
    let proxy: Proxy | null = null;
    let local: http.Server | null = null;
    let reached = 0;
    afterEach(async () => {
        await proxy?.close();
        await new Promise<void>((ok) => (local ? local.close(() => ok()) : ok()));
        proxy = local = null;
        reached = 0;
    });

    /** a service on this machine's loopback that counts who reaches it */
    async function localService(): Promise<number> {
        local = http.createServer((_q, s) => s.end("secret"));
        local.on("connection", () => reached++);
        await new Promise<void>((ok) => local!.listen(0, "127.0.0.1", () => ok()));
        return (local.address() as net.AddressInfo).port;
    }

    function connect(port: number, authority: string): Promise<string> {
        return new Promise((ok, fail) => {
            const s = net.connect(port, "127.0.0.1", () => s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
            let got = "";
            s.on("data", (d) => (got += d));
            s.on("close", () => ok(got));
            s.on("error", fail);
            setTimeout(() => s.destroy(), 3000);
        });
    }

    function get(port: number, url: string): Promise<{ status: number; body: string }> {
        return new Promise((ok, fail) => {
            const r = http.request({ host: "127.0.0.1", port, path: url, headers: { Host: url.startsWith("http") ? new URL(url).host : "proxy" } }, (res) => {
                let body = "";
                res.on("data", (d) => (body += d)).on("end", () => ok({ status: res.statusCode ?? 0, body }));
            });
            r.on("error", fail).end();
        });
    }

    test("tunnels to this machine are refused, by number or by name, and never reach it", async () => {
        const port = await localService();
        proxy = await startProxy({ lookup: async (h) => (h === "rebound.example" ? [{ address: "127.0.0.1" }] : [{ address: "127.0.0.1" }, { address: "::1" }]) });
        for (const authority of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `rebound.example:${port}`, `0.0.0.0:${port}`]) {
            expect(await connect(proxy.port, authority), authority).toStartWith("HTTP/1.1 403");
        }
        expect(reached).toBe(0);
    });

    test("plain HTTP to this machine is refused and never reaches it", async () => {
        const port = await localService();
        proxy = await startProxy({ lookup: async () => [{ address: "127.0.0.1" }] });
        for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://foo.localhost:${port}/`]) {
            const r = await get(proxy.port, url);
            expect(r.status, url).toBe(403);
            expect(r.body).not.toContain("secret");
        }
        expect(reached).toBe(0);
    });

    test("a request that isn't for the proxy is turned away", async () => {
        proxy = await startProxy();
        expect((await get(proxy.port, "/")).status).toBe(400);
        expect(await connect(proxy.port, "no-port")).toStartWith("HTTP/1.1 400");
    });
});
