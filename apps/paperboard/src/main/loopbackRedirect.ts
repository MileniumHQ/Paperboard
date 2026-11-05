// Catching one browser redirect to a loopback address on this device for a
// panel whose program runs on another computer: an installed-app sign-in
// sends the browser to http://localhost:<port>/<path>, and only this device
// can answer there. Listens on 127.0.0.1 (and [::1] where this device has
// it, since a browser may resolve localhost to either) until one GET for
// the redirect's path arrives, answers the tab, and hands back the address
// the browser asked for. Electron-free so it can be tested with real HTTP.
import * as http from "http";
import { logger } from "../../papercrane/logger";
import { LOOPBACK_REDIRECT_TIMEOUT_MS, parseLoopbackRedirectUri, type LoopbackRedirectFailureCode } from "../shared/loopbackRedirect";

export class LoopbackRedirectFailure extends Error {
    constructor(
        readonly code: LoopbackRedirectFailureCode,
        message: string,
    ) {
        super(message);
        this.name = "LoopbackRedirectFailure";
    }
}

export interface LoopbackRedirectOptions {
    /** the page the browser tab lands on once the redirect is caught */
    page: () => string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

// one listener per port across the app: a second sign-in on the same port
// would take the first one's redirect
const listening = new Set<number>();

function listen(server: http.Server, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const failed = (err: Error) => reject(err);
        server.once("error", failed);
        server.listen({ host, port, ipv6Only: host === "::1" }, () => {
            server.off("error", failed);
            resolve();
        });
    });
}

function close(server: http.Server): Promise<void> {
    return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

/**
 * Waits for the browser to request the redirect address on this device and
 * resolves with the full address it requested, spelled with the redirect's
 * own host and port. Throws LoopbackRedirectFailure: invalid-request for an
 * address that is not a loopback redirect, in-use when another program holds
 * the port, busy when this app already listens there, canceled when the
 * signal aborts, timeout after 15 minutes. The port is free again before it
 * settles.
 */
export async function catchLoopbackRedirect(redirectUri: unknown, options: LoopbackRedirectOptions): Promise<string> {
    const redirect = parseLoopbackRedirectUri(redirectUri);
    if (typeof redirect === "string") throw new LoopbackRedirectFailure("invalid-request", redirect);
    const port = Number(redirect.port);
    const signal = options.signal;
    if (signal?.aborted) throw new LoopbackRedirectFailure("canceled", "The sign-in was canceled");
    if (listening.has(port)) throw new LoopbackRedirectFailure("busy", `Paperboard is already waiting for a sign-in on port ${port}`);
    listening.add(port);

    let settle!: (outcome: { url: string } | LoopbackRedirectFailure) => void;
    const outcome = new Promise<{ url: string } | LoopbackRedirectFailure>((resolve) => (settle = resolve));
    let caught = false;
    const answer: http.RequestListener = (req, res) => {
        const raw = req.url ?? "/";
        let requested: URL;
        try {
            requested = new URL(raw.startsWith("/") ? `http://loopback${raw}` : raw);
        } catch (err) {
            logger.warn(`[loopback] refused an unreadable request on port ${port}:`, err);
            res.writeHead(400).end();
            return;
        }
        if (caught || requested.pathname !== redirect.pathname) {
            res.writeHead(404).end();
            return;
        }
        if (req.method !== "GET") {
            res.writeHead(405, { allow: "GET" }).end();
            return;
        }
        caught = true;
        const url = `${redirect.protocol}//${redirect.host}${requested.pathname}${requested.search}`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(options.page(), () => settle({ url }));
    };
    const v4 = http.createServer(answer);
    const v6 = http.createServer(answer);
    const abort = () => settle(new LoopbackRedirectFailure("canceled", "The sign-in was canceled"));
    const timer = setTimeout(
        () => settle(new LoopbackRedirectFailure("timeout", `The sign-in was not finished within ${Math.round((options.timeoutMs ?? LOOPBACK_REDIRECT_TIMEOUT_MS) / 60_000)} minutes`)),
        options.timeoutMs ?? LOOPBACK_REDIRECT_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", abort, { once: true });
    try {
        try {
            await listen(v4, "127.0.0.1", port);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code === "EADDRINUSE") throw new LoopbackRedirectFailure("in-use", `Another program on this device is using port ${port}`);
            throw new LoopbackRedirectFailure("failed", `Could not listen on port ${port}: ${(err as Error)?.message ?? String(err)}`);
        }
        try {
            await listen(v6, "::1", port);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException)?.code;
            // this device has no IPv6 loopback: the browser cannot go there either
            if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") {
                if (code === "EADDRINUSE") throw new LoopbackRedirectFailure("in-use", `Another program on this device is using port ${port} on [::1]`);
                throw new LoopbackRedirectFailure("failed", `Could not listen on port ${port} on [::1]: ${(err as Error)?.message ?? String(err)}`);
            }
        }
        const result = await outcome;
        if (result instanceof LoopbackRedirectFailure) throw result;
        return result.url;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        await Promise.all([close(v4), close(v6)]);
        listening.delete(port);
    }
}
