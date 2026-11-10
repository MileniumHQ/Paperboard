import { afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
// Discovery must not even read the developer's .paperboard before the
// no-network guard below refuses a connection.
const testData = fs.mkdtempSync(path.join(os.tmpdir(), "gameserver-unit-"));
process.env.PAPERBOARD_DIR = testData;
// bun test never fires exit handlers; a preload afterAll runs once the
// process's test files are done
afterAll(() => fs.rmSync(testData, { recursive: true, force: true }));

// Hermetic test guard: unit tests must never open network connections.
// The panel SDK discovers a running daemon through ~/.paperboard/local/crane.json,
// so on a dev machine with Paperboard live, a lazy transport connect reaches the
// REAL daemon — registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails online
// is not a test. This preload replaces the WebSocket constructor for the whole
// test process: any connect attempt fails immediately with this message, which
// makes every suite deterministic no matter what is running on the machine.
const original = globalThis.WebSocket;

// The one exception: a daemon a test started itself (test/helpers/crane.ts)
// on a loopback port, with its handshake inside this process's throwaway
// PAPERBOARD_DIR. Its port is registered here by the helper that spawned
// it, so no other daemon, the developer's included, is ever reachable.
const ALLOWED = Symbol.for("paperboard.gameserver.test.daemonPorts");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

class NoNetworkWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
        const target = new URL(String(url));
        if (
            original &&
            target.protocol === "ws:" &&
            target.hostname === "127.0.0.1" &&
            allowedPorts.has(Number(target.port))
        ) {
            return new original(target, protocols) as unknown as NoNetworkWebSocket;
        }
        throw new Error(
            "unit tests must not open network connections (a live daemon " +
                "would make test results environment-dependent); if a test " +
                "needs the wire, inject a stub transport instead",
        );
    }
}

// Keep the constant shape SDK code may inspect, without offering a socket.
(NoNetworkWebSocket as any).OPEN = original?.OPEN ?? 1;
(NoNetworkWebSocket as any).CONNECTING = original?.CONNECTING ?? 0;
(NoNetworkWebSocket as any).CLOSING = original?.CLOSING ?? 2;
(NoNetworkWebSocket as any).CLOSED = original?.CLOSED ?? 3;

(globalThis as any).WebSocket = NoNetworkWebSocket;

// The same guard for HTTP: the panel talks to Mojang, GeyserMC, Modrinth and
// the loader mavens. A test reaches only loopback servers it started itself,
// so a request anywhere else fails here instead of hitting the internet.
// A test may route one third-party host to a loopback server it started
// (test/helpers/http.ts routeHost), so code with a fixed API address talks to
// that server over real HTTP.
const ROUTES = Symbol.for("paperboard.gameserver.test.hostRoutes");
const routes: Map<string, string> = ((globalThis as any)[ROUTES] ??= new Map<string, string>());
const originalFetch = globalThis.fetch;
const guardedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : String(input));
    const routed = routes.get(url.host);
    if (routed) {
        url = new URL(`${url.pathname}${url.search}`, routed);
        input = input instanceof Request ? new Request(url, input) : url;
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        return Promise.reject(new Error(`unit tests must not reach the network (fetch ${url.origin}); serve it from a loopback server`));
    }
    return originalFetch(input, init);
}) as typeof fetch;
globalThis.fetch = Object.assign(guardedFetch, originalFetch);
