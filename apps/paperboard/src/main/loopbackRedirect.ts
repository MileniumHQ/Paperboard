// Catching one browser redirect to a loopback address on this device: an
// installed-app sign-in sends the browser to http://127.0.0.1 or
// http://localhost:<port>/<path>, and only this device can answer there.
// Two sign-ins use it: Google Drive's (googleOAuth.ts, on a port the OS
// picks) and a panel's whose program runs on another computer (on the port
// the panel's redirect names). Listens on 127.0.0.1, and for a named port on
// [::1] too where this device has it, since a browser may resolve localhost
// to either. Electron-free so it can be tested with real HTTP.
import * as http from "http";
import { logger } from "daemon/logger";
import { LOOPBACK_REDIRECT_TIMEOUT_MS, parseLoopbackRedirectUri, type LoopbackRedirectFailureCode } from "../shared/loopbackRedirect";
import { errorCode } from "@mileniumhq/paperapi/errors";

export class LoopbackRedirectFailure extends Error {
    constructor(
        readonly code: LoopbackRedirectFailureCode,
        message: string,
    ) {
        super(message);
        this.name = "LoopbackRedirectFailure";
    }
}

export interface RedirectListenOptions {
    /** the port to listen on; 0 lets the OS pick one, on 127.0.0.1 only */
    port: number;
    /** the redirect's path; a request for any other gets 404 */
    pathname: string;
    /** whether a request for the path is the redirect (a sign-in checks its state); 404 when not */
    accept?: (requested: URL) => boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface CaughtRedirect {
    /** what the browser asked for: its path and query (its host is not the redirect's) */
    requested: URL;
    /** answers the tab, once; resolves when the page is sent */
    answer(page: string): Promise<void>;
}

export interface RedirectListener {
    /** the port listened on */
    port: number;
    /** the first GET the listener takes. Throws LoopbackRedirectFailure: canceled when the signal aborts, timeout */
    caught(): Promise<CaughtRedirect>;
    /** stops listening; the port is free again once it resolves */
    close(): Promise<void>;
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

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

function listenFailure(err: unknown, port: number, where: string): LoopbackRedirectFailure {
    if (errorCode(err) === "EADDRINUSE") return new LoopbackRedirectFailure("in-use", `Another program on this device is using port ${port}${where}`);
    return new LoopbackRedirectFailure("failed", `Could not listen on port ${port}${where}: ${(err as Error)?.message ?? String(err)}`);
}

/**
 * Listens for the redirect. Throws LoopbackRedirectFailure: canceled when
 * the signal already aborted, busy when this app already listens on the
 * port, in-use when another program holds it, failed otherwise. The timeout
 * (15 minutes unless given) runs from here.
 */
export async function listenForRedirect(options: RedirectListenOptions): Promise<RedirectListener> {
    const { port, signal } = options;
    if (signal?.aborted) throw new LoopbackRedirectFailure("canceled", "The sign-in was canceled");
    if (port && listening.has(port)) throw new LoopbackRedirectFailure("busy", `Paperboard is already waiting for a sign-in on port ${port}`);
    if (port) listening.add(port);

    let settle!: (outcome: CaughtRedirect | LoopbackRedirectFailure) => void;
    const outcome = new Promise<CaughtRedirect | LoopbackRedirectFailure>((resolve) => (settle = resolve));
    let caught = false;
    const respond: http.RequestListener = (req, res) => {
        const raw = req.url ?? "/";
        let requested: URL;
        try {
            requested = new URL(raw.startsWith("/") ? `http://loopback${raw}` : raw);
        } catch (err) {
            logger.warn(`[loopback] refused an unreadable request on port ${port}:`, err);
            res.writeHead(400).end();
            return;
        }
        if (caught || requested.pathname !== options.pathname || (options.accept && !options.accept(requested))) {
            res.writeHead(404).end();
            return;
        }
        if (req.method !== "GET") {
            res.writeHead(405, { allow: "GET" }).end();
            return;
        }
        caught = true;
        let answered = false;
        settle({
            requested,
            answer: (page) =>
                new Promise<void>((resolve) => {
                    if (answered) return resolve();
                    answered = true;
                    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
                    res.end(page, () => resolve());
                }),
        });
    };
    const servers = [http.createServer(respond)];
    const timeoutMs = options.timeoutMs ?? LOOPBACK_REDIRECT_TIMEOUT_MS;
    const timer = setTimeout(() => settle(new LoopbackRedirectFailure("timeout", `The sign-in was not finished within ${Math.round(timeoutMs / 60_000)} minutes`)), timeoutMs);
    const abort = () => settle(new LoopbackRedirectFailure("canceled", "The sign-in was canceled"));
    signal?.addEventListener("abort", abort, { once: true });
    let closed: Promise<void> | null = null;
    const close = () =>
        (closed ??= (async () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            await Promise.all(servers.map(closeServer));
            if (port) listening.delete(port);
        })());

    try {
        try {
            await listen(servers[0], "127.0.0.1", port);
        } catch (err) {
            throw listenFailure(err, port, "");
        }
        if (port) {
            const v6 = http.createServer(respond);
            servers.push(v6);
            try {
                await listen(v6, "::1", port);
            } catch (err) {
                const code = errorCode(err);
                // this device has no IPv6 loopback: the browser cannot go there either
                if (code !== "EADDRNOTAVAIL" && code !== "EAFNOSUPPORT") throw listenFailure(err, port, " on [::1]");
            }
        }
    } catch (err) {
        await close();
        throw err;
    }
    return {
        port: (servers[0].address() as { port: number }).port,
        async caught() {
            const result = await outcome;
            if (result instanceof LoopbackRedirectFailure) throw result;
            return result;
        },
        close,
    };
}

/**
 * A panel's redirect: waits for the browser to request the redirect address
 * on this device, answers the tab with `page`, and resolves with the full
 * address it requested, spelled with the redirect's own host and port.
 * Throws LoopbackRedirectFailure: invalid-request for an address that is
 * not a loopback redirect, and as listenForRedirect does. The port is free
 * again before it settles.
 */
export async function catchLoopbackRedirect(redirectUri: unknown, options: { page: () => string; signal?: AbortSignal; timeoutMs?: number }): Promise<string> {
    const redirect = parseLoopbackRedirectUri(redirectUri);
    if (typeof redirect === "string") throw new LoopbackRedirectFailure("invalid-request", redirect);
    const listener = await listenForRedirect({ port: Number(redirect.port), pathname: redirect.pathname, signal: options.signal, timeoutMs: options.timeoutMs });
    try {
        const { requested, answer } = await listener.caught();
        await answer(options.page());
        return `${redirect.protocol}//${redirect.host}${requested.pathname}${requested.search}`;
    } finally {
        await listener.close();
    }
}
