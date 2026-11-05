// Catching a panel's sign-in redirect on this device (bun test): real
// listeners on real ports, reached with real HTTP. Only the redirect's path
// is answered, the address comes back as the browser asked for it, and the
// port is free again however the wait ends.
import { afterEach, describe, expect, it } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";
import { once } from "node:events";
import { catchLoopbackRedirect, LoopbackRedirectFailure } from "../src/main/loopbackRedirect";
import { parseLoopbackRedirectUri } from "../src/shared/loopbackRedirect";

const PAGE = "<p>Return to Paperboard to finish signing in. You can close this tab.</p>";
const servers: http.Server[] = [];
afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise<void>((resolve) => s.close(() => resolve()));
});

// a port nothing listens on right now, from the high range
async function freePort(): Promise<number> {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return port;
}

async function failure(promise: Promise<unknown>): Promise<LoopbackRedirectFailure> {
    try {
        await promise;
    } catch (err) {
        if (err instanceof LoopbackRedirectFailure) return err;
        throw err;
    }
    throw new Error("expected the wait to fail");
}

// resolves once something accepts connections on the port
async function listeningOn(port: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
        const ok = await new Promise<boolean>((resolve) => {
            const socket = net.connect(port, "127.0.0.1", () => {
                socket.destroy();
                resolve(true);
            });
            socket.on("error", () => resolve(false));
        });
        if (ok) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`nothing listened on ${port}`);
}

describe("catching a loopback redirect", () => {
    it("answers the redirect's path with the page and hands back the address the browser asked for", async () => {
        const port = await freePort();
        const caught = catchLoopbackRedirect(`http://localhost:${port}/auth/callback`, { page: () => PAGE });
        await listeningOn(port);
        const res = await fetch(`http://127.0.0.1:${port}/auth/callback?code=abc&state=xyz`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(await res.text()).toBe(PAGE);
        // spelled with the redirect's own host and port
        expect(await caught).toBe(`http://localhost:${port}/auth/callback?code=abc&state=xyz`);
        // and the port is free again
        await expect(fetch(`http://127.0.0.1:${port}/auth/callback`)).rejects.toThrow();
    });

    it("answers on [::1] too, where a browser may resolve localhost", async () => {
        const probe = net.createServer();
        const hasV6 = await new Promise<boolean>((resolve) => {
            probe.once("error", () => resolve(false));
            probe.listen({ host: "::1", port: 0, ipv6Only: true }, () => resolve(true));
        });
        if (hasV6) await new Promise<void>((resolve) => probe.close(() => resolve()));
        const port = await freePort();
        const caught = catchLoopbackRedirect(`http://localhost:${port}/cb`, { page: () => PAGE });
        await listeningOn(port);
        // a device without IPv6 loopback has only 127.0.0.1, and so does its browser
        const res = await fetch(`http://${hasV6 ? "[::1]" : "127.0.0.1"}:${port}/cb?code=6`);
        expect(res.status).toBe(200);
        expect(await caught).toBe(`http://localhost:${port}/cb?code=6`);
    });

    it("answers another path with 404 and keeps waiting", async () => {
        const port = await freePort();
        const controller = new AbortController();
        let settled = false;
        const caught = catchLoopbackRedirect(`http://127.0.0.1:${port}/callback`, { page: () => PAGE, signal: controller.signal });
        caught.then(
            () => (settled = true),
            () => (settled = true),
        );
        await listeningOn(port);
        expect((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${port}/callback/extra?code=1`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${port}/callback`, { method: "POST" })).status).toBe(405);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(settled).toBe(false);
        const res = await fetch(`http://127.0.0.1:${port}/callback?code=2`);
        expect(res.status).toBe(200);
        expect(await caught).toBe(`http://127.0.0.1:${port}/callback?code=2`);
    });

    it("refuses a port another program holds, naming it", async () => {
        const port = await freePort();
        const other = http.createServer((_req, res) => res.end("other"));
        servers.push(other);
        other.listen(port, "127.0.0.1");
        await once(other, "listening");
        const err = await failure(catchLoopbackRedirect(`http://localhost:${port}/cb`, { page: () => PAGE }));
        expect(err.code).toBe("in-use");
        expect(err.message).toContain(String(port));
        // the other program still answers
        expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("other");
    });

    it("lets one wait per port: a second one is busy", async () => {
        const port = await freePort();
        const controller = new AbortController();
        const first = catchLoopbackRedirect(`http://localhost:${port}/cb`, { page: () => PAGE, signal: controller.signal });
        await listeningOn(port);
        expect((await failure(catchLoopbackRedirect(`http://127.0.0.1:${port}/other`, { page: () => PAGE }))).code).toBe("busy");
        controller.abort();
        expect((await failure(first)).code).toBe("canceled");
    });

    it("stops listening when the signal aborts, freeing the port", async () => {
        const port = await freePort();
        const controller = new AbortController();
        const caught = catchLoopbackRedirect(`http://localhost:${port}/cb`, { page: () => PAGE, signal: controller.signal });
        await listeningOn(port);
        controller.abort();
        expect((await failure(caught)).code).toBe("canceled");
        await expect(fetch(`http://127.0.0.1:${port}/cb`)).rejects.toThrow();
        // the port can be bound again, by anyone
        const again = http.createServer();
        servers.push(again);
        again.listen(port, "127.0.0.1");
        await once(again, "listening");
    });

    it("gives up after the timeout, freeing the port", async () => {
        const port = await freePort();
        const err = await failure(catchLoopbackRedirect(`http://localhost:${port}/cb`, { page: () => PAGE, timeoutMs: 50 }));
        expect(err.code).toBe("timeout");
        await expect(fetch(`http://127.0.0.1:${port}/cb`)).rejects.toThrow();
    });

    it("refuses an address that is not a loopback redirect before listening", async () => {
        for (const bad of [
            "",
            "not a url",
            "https://localhost:1455/cb",
            "http://example.com:1455/cb",
            "http://192.168.1.2:1455/cb",
            "http://localhost/cb",
            "http://localhost:80/cb",
            "http://localhost:1023/cb",
            "http://localhost:65536/cb",
            "http://user:pw@localhost:1455/cb",
            "http://localhost:1455/cb#frag",
            "file:///etc/passwd",
            42,
        ]) {
            expect((await failure(catchLoopbackRedirect(bad, { page: () => PAGE }))).code).toBe("invalid-request");
        }
    });
});

describe("loopback redirect addresses", () => {
    it("takes http on a loopback host with an explicit high port", () => {
        for (const ok of ["http://localhost:1455/auth/callback", "http://127.0.0.1:8085/", "http://[::1]:65535/cb?x=1"]) {
            expect(parseLoopbackRedirectUri(ok)).toBeInstanceOf(URL);
        }
        expect(typeof parseLoopbackRedirectUri("http://localhost.example.com:1455/cb")).toBe("string");
        expect(typeof parseLoopbackRedirectUri(`http://localhost:1455/${"a".repeat(3000)}`)).toBe("string");
    });
});
