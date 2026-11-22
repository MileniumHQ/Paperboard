import { describe, expect, test } from "bun:test";
import * as net from "node:net";
import { catchLoopbackRedirect, LoopbackRedirectFailure } from "../../src/main/loopbackRedirect";

const PAGE = "<p>Signed in. You can close this tab.</p>";

// a port the OS just handed out and took back
async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

// resolves once something listens on the port (the catcher is up)
function listening(port: number): Promise<void> {
    return new Promise((resolve) => {
        const attempt = () => {
            const socket = net.connect(port, "127.0.0.1");
            socket.once("connect", () => { socket.destroy(); resolve(); });
            socket.once("error", () => { socket.destroy(); setImmediate(attempt); });
        };
        attempt();
    });
}

// the port can be bound again: nothing holds it
async function isFree(port: number): Promise<boolean> {
    const server = net.createServer();
    return new Promise((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
}

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("it resolved"); }, (err: LoopbackRedirectFailure) => err);

// Loopback redirect capture is narrow and always frees its port.
describe("catching a loopback sign-in redirect", () => {
    test("answers only a GET for the exact path, hands back the address, and frees the port", async () => {
        const port = await freePort();
        const caught = catchLoopbackRedirect(`http://localhost:${port}/oauth/callback`, { page: () => PAGE });
        await listening(port);
        expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${port}/oauth/callback/more`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${port}/oauth/callback`, { method: "POST" })).status).toBe(405);
        const tab = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=abc&state=xyz`);
        expect(tab.status).toBe(200);
        expect(await tab.text()).toBe(PAGE);
        expect(await caught).toBe(`http://localhost:${port}/oauth/callback?code=abc&state=xyz`);
        expect(await isFree(port)).toBe(true);
    });

    test("refuses anything but plain http on a loopback host with an explicit port of 1024 or more, before listening", async () => {
        const port = await freePort();
        for (const uri of [
            `https://127.0.0.1:${port}/cb`,
            `http://example.com:${port}/cb`,
            `http://192.168.1.2:${port}/cb`,
            "http://localhost/cb",
            "http://localhost:80/cb",
            "http://localhost:1023/cb",
            `http://user:pw@localhost:${port}/cb`,
            `http://localhost:${port}/cb#frag`,
            "not an address",
            42,
        ]) {
            const err = await failure(catchLoopbackRedirect(uri, { page: () => PAGE }));
            expect({ uri, code: err.code }).toEqual({ uri, code: "invalid-request" });
        }
        expect(await isFree(port)).toBe(true);
    });
});
