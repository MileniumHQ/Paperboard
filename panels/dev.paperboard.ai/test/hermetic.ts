// Hermetic test guard: unit tests must never open network connections.
// The panel SDK discovers a running daemon through ~/.paperboard/local/crane.json,
// so on a dev machine with Paperboard live, a lazy transport connect reaches the
// REAL daemon — registrations CONFLICT with the live panel's socket and API calls
// return answers from real sessions. A test that passes offline and fails online
// is not a test. This preload replaces the WebSocket constructor for the whole
// test process: any connect attempt fails immediately with this message, which
// makes every suite deterministic no matter what is running on the machine.
const original = globalThis.WebSocket;

class NoNetworkWebSocket {
    constructor() {
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
