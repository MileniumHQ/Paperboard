// fetchPublic against real servers on loopback. Loopback is what the rule
// refuses, so a test reaches its own servers only by naming their origins in
// trustedOrigins; every other address goes through the rule as it would in a
// panel. No outside network: names are resolved by a stand-in lookup.
import { afterAll, describe, expect, test } from "bun:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { fetchPublic, publicAddressRefusal, PublicFetchError, type PublicFetchAnswer, type PublicFetchDial } from "../src/net";

const hits: string[] = [];
const servers: http.Server[] = [];
type Answer = { status?: number; headers?: Record<string, string>; body?: string | Uint8Array; chunks?: string[]; never?: true };
async function serve(name: string, answer: (path: string) => Answer): Promise<number> {
    const server = http.createServer((req, res) => {
        hits.push(`${name} ${req.url} host=${req.headers.host}`);
        const a = answer(req.url ?? "/");
        if (a.never) return;
        res.writeHead(a.status ?? 200, a.headers ?? {});
        // chunks go out with no Content-Length: the cap has to stop the body itself
        for (const chunk of a.chunks ?? []) res.write(chunk);
        res.end(a.body);
    });
    servers.push(server);
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    return (server.address() as AddressInfo).port;
}
afterAll(() => {
    for (const s of servers) {
        s.closeAllConnections();
        s.close();
    }
});

// what a panel keeps private: a service on this computer
const insidePort = await serve("inside", () => ({ body: "the secret" }));
const filesPort = await serve("files", (path): Answer => {
    if (path === "/cat.png") return { headers: { "content-type": "image/png" }, body: new Uint8Array([1, 2, 3, 4]) };
    if (path === "/to-inside") return { status: 302, headers: { location: `http://127.0.0.1:${insidePort}/` } };
    if (path === "/to-inside-by-name") return { status: 307, headers: { location: `http://intranet.example:${insidePort}/` } };
    if (path === "/to-file") return { status: 302, headers: { location: "file:///etc/passwd" } };
    if (path === "/loop") return { status: 302, headers: { location: "/loop" } };
    if (path === "/declared-big") return { headers: { "content-length": "64" }, body: "x".repeat(64) };
    if (path === "/streamed-big") return { chunks: Array(8).fill("x".repeat(16)) };
    if (path === "/never") return { never: true };
    return { status: 404, body: "Not found" };
});
const FILES = `http://127.0.0.1:${filesPort}`;
const trusted = { maxBytes: 32, trustedOrigins: [FILES] };
const lookup = (address: string) => async () => [{ address }];

async function refusal(work: Promise<unknown>): Promise<{ code: string; message: string }> {
    const err = await work.then(
        () => new Error("it was fetched"),
        (e: unknown) => e,
    );
    if (!(err instanceof PublicFetchError)) throw err;
    return { code: err.code, message: err.message };
}

function ownAddress(): string {
    for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (!i.internal && i.family === "IPv4") return i.address;
    return "127.0.0.1";
}

describe("which addresses are public", () => {
    test("loopback, private, link-local, CGNAT, multicast, reserved, metadata, IPv6 carrying any of them, and this computer are refused", () => {
        for (const ip of [
            "127.0.0.1",
            "127.255.0.9",
            "0.0.0.0",
            "10.1.2.3",
            "172.16.5.4",
            "172.31.255.255",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.100.100.200",
            "168.63.129.16",
            "224.0.0.251",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "[::1]",
            "::ffff:127.0.0.1",
            "::ffff:7f00:1",
            "::ffff:192.168.1.1",
            "::ffff:0:a00:1",
            "::127.0.0.1",
            "64:ff9b::a9fe:a9fe",
            "2002:7f00:1::",
            "2001::1",
            "fc00::1",
            "fd00:ec2::254",
            "fe80::1",
            "fe80::1%eth0",
            "ff02::1",
            ownAddress(),
            "localhost",
            "not an address",
        ]) {
            expect({ ip, refused: publicAddressRefusal(ip) !== null }).toEqual({ ip, refused: true });
        }
        for (const ip of ["93.184.216.34", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:1.1.1.1", "64:ff9b::101:101"]) {
            expect({ ip, refused: publicAddressRefusal(ip) }).toEqual({ ip, refused: null });
        }
    });
});

describe("fetchPublic", () => {
    test("this computer is refused by number or by a name that resolves to it, and is never asked", async () => {
        hits.length = 0;
        for (const url of [`http://127.0.0.1:${insidePort}/`, `http://[::1]:${insidePort}/`, `http://[::ffff:127.0.0.1]:${insidePort}/`, `http://${ownAddress()}:${insidePort}/`, `http://2130706433:${insidePort}/`]) {
            expect({ url, ...(await refusal(fetchPublic(url, { maxBytes: 32 }))) }).toMatchObject({ url, code: "refused" });
        }
        expect(await refusal(fetchPublic(`http://intranet.example:${insidePort}/`, { maxBytes: 32, lookup: lookup("127.0.0.1") }))).toEqual({
            code: "refused",
            message: "intranet.example is on this computer or its local network (127.0.0.1)",
        });
        expect(await refusal(fetchPublic("http://router.example/", { maxBytes: 32, lookup: lookup("192.168.1.1") }))).toMatchObject({ code: "refused" });
        expect(hits).toEqual([]);
    });

    test("only http and https addresses, with no password in them", async () => {
        for (const url of ["file:///etc/passwd", "/home/me/.ssh/id_ed25519", "data:text/plain,hi", "ftp://example.com/a", `http://me:pw@127.0.0.1:${filesPort}/cat.png`, "", undefined]) {
            expect({ url, ...(await refusal(fetchPublic(url, trusted))) }).toMatchObject({ url, code: "invalid-url" });
        }
    });

    test("the address checked is the one dialed, resolved once per hop, and the request names the host", async () => {
        hits.length = 0;
        let lookups = 0;
        const named = `http://files.example:${filesPort}`;
        const res = await fetchPublic(`${named}/cat.png`, {
            maxBytes: 32,
            trustedOrigins: [named],
            lookup: async () => {
                lookups++;
                return [{ address: "127.0.0.1" }];
            },
        });
        expect(res).toEqual({ url: `${named}/cat.png`, status: 200, contentType: "image/png", body: new Uint8Array([1, 2, 3, 4]) });
        expect(lookups).toBe(1);
        expect(hits).toEqual([`files /cat.png host=files.example:${filesPort}`]);
    });

    test("every redirect is checked like the first address", async () => {
        hits.length = 0;
        expect(await refusal(fetchPublic(`${FILES}/to-inside`, trusted))).toEqual({ code: "refused", message: `127.0.0.1:${insidePort} is a private or local address` });
        expect(await refusal(fetchPublic(`${FILES}/to-inside-by-name`, { ...trusted, lookup: lookup("127.0.0.1") }))).toMatchObject({ code: "refused" });
        expect(await refusal(fetchPublic(`${FILES}/to-file`, trusted))).toMatchObject({ code: "invalid-url" });
        expect(await refusal(fetchPublic(`${FILES}/loop`, trusted))).toEqual({ code: "bad-response", message: `127.0.0.1:${filesPort} redirected more than 3 times` });
        expect(hits.filter((h) => h.startsWith("inside"))).toEqual([]);
    });

    test("a body over maxBytes is refused, whether or not its size is declared", async () => {
        expect(await refusal(fetchPublic(`${FILES}/declared-big`, trusted))).toEqual({ code: "too-large", message: `The file at 127.0.0.1:${filesPort} is over 32 bytes` });
        expect(await refusal(fetchPublic(`${FILES}/streamed-big`, trusted))).toMatchObject({ code: "too-large" });
        expect((await fetchPublic(`${FILES}/streamed-big`, { ...trusted, maxBytes: 128 })).body.length).toBe(128);
    });

    test("an error answer, or one that never comes, fails with why", async () => {
        expect(await refusal(fetchPublic(`${FILES}/missing`, trusted))).toEqual({ code: "bad-response", message: `127.0.0.1:${filesPort} answered 404 Not Found` });
        expect(await refusal(fetchPublic(`${FILES}/never`, { ...trusted, timeoutMs: 300 }))).toEqual({ code: "timeout", message: `127.0.0.1:${filesPort} took longer than 300 ms to answer` });
        expect(await refusal(fetchPublic("http://nowhere.example/", { maxBytes: 32, lookup: async () => Promise.reject(new Error("ENOTFOUND")) }))).toMatchObject({ code: "unreachable" });
    });

    test("a dial of its own is handed the address checked for each hop, and its answer is read as the default's is", async () => {
        const names: Record<string, string> = { "images.example": "93.184.216.34", "cdn.example": "1.1.1.1", "intranet.example": "10.1.2.3" };
        const pages: Record<string, { status: number; headers: Record<string, string>; body?: string }> = {
            "https://images.example/moved": { status: 302, headers: { location: "https://cdn.example/cat.png" } },
            "https://cdn.example/cat.png": { status: 200, headers: { "content-type": "image/png" }, body: "png" },
            "https://images.example/sneaky": { status: 301, headers: { location: "https://intranet.example/admin.png" } },
        };
        const asked: string[] = [];
        let open = 0;
        const dial: PublicFetchDial = async (address, url, request) => {
            asked.push(`${address} ${url.href} accept=${request.accept}`);
            const page = pages[url.href];
            if (!page) throw new Error(`the test serves no ${url.href}`);
            open++;
            const answer: PublicFetchAnswer = {
                status: page.status,
                statusText: "",
                headers: page.headers,
                body: (async function* () {
                    if (page.body) yield new TextEncoder().encode(page.body);
                })(),
                close: () => open--,
            };
            return answer;
        };
        const options = { maxBytes: 32, accept: "image/*", dial, lookup: async (host: string) => [{ address: names[host]! }] };
        const res = await fetchPublic("https://images.example/moved", options);
        expect(res).toEqual({ url: "https://cdn.example/cat.png", status: 200, contentType: "image/png", body: new TextEncoder().encode("png") });
        expect(asked).toEqual(["93.184.216.34 https://images.example/moved accept=image/*", "1.1.1.1 https://cdn.example/cat.png accept=image/*"]);
        expect(await refusal(fetchPublic("https://images.example/sneaky", options))).toMatchObject({ code: "refused" });
        expect(asked.at(-1)).toBe("93.184.216.34 https://images.example/sneaky accept=image/*");
        // every answer was closed, the refused hop's too
        expect(open).toBe(0);
    });

    test("requireHttps refuses an http address, and a redirect to one, before it is dialed", async () => {
        const asked: string[] = [];
        const dial: PublicFetchDial = async (_address, url) => {
            asked.push(url.href);
            return { status: 302, statusText: "Found", headers: { location: "http://cdn.example/cat.png" }, body: (async function* () {})(), close: () => {} };
        };
        const options = { maxBytes: 32, requireHttps: true, dial, lookup: lookup("93.184.216.34") };
        expect(await refusal(fetchPublic("http://images.example/cat.png", options))).toEqual({ code: "invalid-url", message: "Only https addresses are fetched, not http:" });
        expect(asked).toEqual([]);
        expect(await refusal(fetchPublic("https://images.example/moved", options))).toEqual({ code: "invalid-url", message: "Only https addresses are fetched, not http:" });
        expect(asked).toEqual(["https://images.example/moved"]);
    });
});
