// Dialing a paired computer that is known by more than one address (its
// .local name and the IP it last answered at). Every address is dialed at
// once, and the first socket whose TLS handshake shows the pinned
// certificate carries the connection; the others are dropped. Who answered
// is told by the certificate, never by the address, so a name that leads
// somewhere else only fails its own dial. Used by the app's connection to a
// computer and by the daemon's tunnels to it.
import type { WebSocket } from "ws";
import { pinnedTlsOptions } from "./pinnedTls";
import { pinnableWebSocket } from "./pinnableWebSocket";

export interface PinnedDial {
    /** the open socket and the address that answered */
    result: Promise<{ socket: WebSocket; host: string }>;
    /** drops every dial; `result` rejects with "Connection attempt was superseded" */
    cancel: () => void;
}

const where = (host: string, port: number) => `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;

/** Throws at once for a pinned certificate that can't be read: the same every time. */
export function dialPinned(hosts: readonly string[], port: number, cert: string, options: { timeoutMs: number; maxPayload?: number }): PinnedDial {
    if (hosts.length === 0) throw new Error("A computer needs an address to connect to");
    const tls = pinnedTlsOptions(cert);
    const Socket = pinnableWebSocket();
    // set by the promise's executor, which runs before this returns
    let cancel!: () => void;
    const result = new Promise<{ socket: WebSocket; host: string }>((resolve, reject) => {
        const failures = new Map<string, string>();
        const dials = [...new Set(hosts)].map((host) => ({
            host,
            socket: new Socket(`wss://${where(host, port)}`, { ...tls, ...(options.maxPayload ? { maxPayload: options.maxPayload } : {}) }),
        }));
        let done = false;
        const finish = (outcome: Error | { socket: WebSocket; host: string }) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            for (const dial of dials) {
                dial.socket.removeAllListeners("open");
                dial.socket.removeAllListeners("error");
                if (!(outcome instanceof Error) && dial.socket === outcome.socket) continue;
                dial.socket.on("error", () => {
                    // quiet: a dropped dial reports its own closing, which nobody waits for
                });
                dial.socket.terminate();
            }
            if (outcome instanceof Error) reject(outcome);
            else resolve(outcome);
        };
        const timer = setTimeout(
            () => finish(new Error(`Could not reach ${dials.map((d) => where(d.host, port)).join(" or ")}: no answer within ${options.timeoutMs / 1000} s`)),
            options.timeoutMs,
        );
        cancel = () => finish(new Error("Connection attempt was superseded"));
        for (const dial of dials) {
            dial.socket.once("open", () => finish(dial));
            dial.socket.on("error", (err: Error) => {
                failures.set(dial.host, err?.message ?? "");
                if (failures.size < dials.length) return;
                const said = (host: string) => failures.get(host) || "no answer";
                finish(new Error(
                    dials.length === 1
                        ? `Cannot connect to the Paperboard server daemon at ${where(dials[0]!.host, port)}${failures.get(dials[0]!.host) ? `: ${failures.get(dials[0]!.host)}` : ""}`
                        : `Cannot connect to the Paperboard server daemon at ${dials.map((d) => `${where(d.host, port)} (${said(d.host)})`).join(" or ")}`,
                ));
            });
        }
    });
    return { result, cancel: () => cancel() };
}
