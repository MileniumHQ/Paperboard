// Hermetic test guard: unit tests must never reach a live Paperboard.
// The panel SDK finds a running daemon through local/crane.json in the
// Paperboard data folder (PAPERBOARD_DIR, or ~/.paperboard), so on a dev
// machine with Paperboard live, a lazy transport connect reaches the REAL
// daemon: registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails
// online is not a test. This preload gives the whole test process a
// throwaway data folder, and replaces the WebSocket constructor so any
// connect attempt fails immediately with this message, which makes every
// suite deterministic no matter what is running on the machine.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "panel-test-"));
process.env.PAPERBOARD_DIR = dataDir;
// bun test fires no process exit handlers; a preload's afterAll runs once,
// after every test file
afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
});

const original = globalThis.WebSocket;

// The one exception: the headless Chrome a browser test started itself, on
// the loopback DevTools port its helper registered here (browserFixture.ts).
const ALLOWED = Symbol.for("paperboard.blocks.test.ports");
const allowedPorts: Set<number> = ((globalThis as any)[ALLOWED] ??= new Set<number>());

class NoNetworkWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
        const target = new URL(String(url));
        if (original && target.protocol === "ws:" && target.hostname === "127.0.0.1" && allowedPorts.has(Number(target.port))) {
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
