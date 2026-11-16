// A real loopback HTTP server standing in for a third-party API (Mojang,
// GeyserMC, Modrinth, a Maven host). It answers from a route table and
// records every request path it got.
import { afterAll } from "bun:test";
import { TEST_TRUSTED_ORIGINS_ENV } from "@mileniumhq/paperapi/net";

export interface LoopbackServer {
    url: string;
    requests: string[];
    stop(): void;
}

const running: LoopbackServer[] = [];
afterAll(() => {
    for (const server of running.splice(0)) server.stop();
});

export function loopbackServer(handle: (req: Request, url: URL) => Response | Promise<Response>): LoopbackServer {
    const requests: string[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
            const url = new URL(req.url);
            requests.push(url.pathname + url.search);
            return handle(req, url);
        },
    });
    const handle_: LoopbackServer = { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
    running.push(handle_);
    return handle_;
}

/**
 * Lets fetchPublic in this process reach the loopback server as it would a
 * public host (PaperAPI's test-only trusted origins), until the file ends.
 */
export function trustLoopback(server: LoopbackServer): void {
    const before = process.env[TEST_TRUSTED_ORIGINS_ENV];
    process.env[TEST_TRUSTED_ORIGINS_ENV] = [before, server.url].filter(Boolean).join(",");
    trusted.push(before);
}
// what the setting was before each trustLoopback, the first first
const trusted: (string | undefined)[] = [];
afterAll(() => {
    if (trusted.length === 0) return;
    const first = trusted[0];
    trusted.length = 0;
    if (first === undefined) delete process.env[TEST_TRUSTED_ORIGINS_ENV];
    else process.env[TEST_TRUSTED_ORIGINS_ENV] = first;
});

/** Sends this process's requests for `host` (e.g. "api.modrinth.com") to the loopback server, until the file ends. */
export function routeHost(host: string, server: LoopbackServer): void {
    const routes: Map<string, string> = (globalThis as any)[Symbol.for("paperboard.gameserver.test.hostRoutes")];
    if (!routes) throw new Error("test/hermetic.ts is not preloaded");
    routes.set(host, server.url);
}
