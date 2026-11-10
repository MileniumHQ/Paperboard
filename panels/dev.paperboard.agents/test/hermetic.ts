// Hermetic test guard: unit tests must never open network connections.
// The panel SDK discovers a running daemon through ~/.paperboard/local/crane.json,
// so on a dev machine with Paperboard live, a lazy transport connect reaches the
// REAL daemon — registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails online
// is not a test. This preload replaces the WebSocket constructor for the whole
// test process: any connect attempt fails immediately with this message, which
// makes every suite deterministic no matter what is running on the machine.
import { afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const original = globalThis.WebSocket;

/** endpoints a test is serving itself, on loopback: the only sockets it may open */
const allowed = new Set<string>();

/** Let sockets reach one endpoint the test serves itself (a fake browser's DevTools); returns the undo. */
export function allowTestEndpoint(url: string): () => void {
    if (new URL(url).hostname !== "127.0.0.1") throw new Error("only a loopback endpoint the test serves can be allowed");
    allowed.add(url);
    return () => allowed.delete(url);
}

class NoNetworkWebSocket {
    constructor(url: string | URL) {
        if (allowed.has(String(url))) return new original(url) as unknown as NoNetworkWebSocket;
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

// Nothing a test runs may reach the user's ~/.paperboard: the test process,
// and every program it starts, gets a throwaway one of its own.
process.env.PAPERBOARD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pb-agents-home-"));
const throwaway = process.env.PAPERBOARD_DIR;
// a preload's afterAll runs once, after every suite in the process
afterAll(() => fs.rmSync(throwaway, { recursive: true, force: true }));
