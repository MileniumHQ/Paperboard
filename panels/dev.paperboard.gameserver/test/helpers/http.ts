// A real loopback HTTP server standing in for a third-party API (Mojang,
// GeyserMC, Modrinth, a Maven host). It answers from a route table and
// records every request path it got.
import { afterAll } from "bun:test";

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

/** Sends this process's requests for `host` (e.g. "api.modrinth.com") to the loopback server, until the file ends. */
export function routeHost(host: string, server: LoopbackServer): void {
    const routes: Map<string, string> = (globalThis as any)[Symbol.for("paperboard.gameserver.test.hostRoutes")];
    if (!routes) throw new Error("test/hermetic.ts is not preloaded");
    routes.set(host, server.url);
}
