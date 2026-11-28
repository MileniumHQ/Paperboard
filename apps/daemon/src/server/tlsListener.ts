// The daemon's TLS listener, for every computer but this one. It asks each
// client for a certificate and requires none: the app, panels and the
// browser connect without one, and a daemon linking to this one presents
// its own (network/links.ts reads it and decides). Bun's https server can't
// hand a client certificate over, so this is a tls server handing each
// connection to an http server, which reads the same on Bun and Node.
import * as http from "http";
import * as tls from "tls";
import { logger } from "../core/logger";
import type { TlsIdentity } from "../security/tlsIdentity";

export interface TlsListener {
    /** listens and closes (closeTlsListener); "close" once every connection has ended */
    server: tls.Server;
    /** serves the requests and upgrades of every connection */
    http: http.Server;
}

export function createTlsListener(identity: TlsIdentity, onRequest: http.RequestListener): TlsListener {
    const server = tls.createServer({ key: identity.key, cert: identity.cert, requestCert: true, rejectUnauthorized: false });
    const httpServer = http.createServer(onRequest);
    server.on("secureConnection", (socket) => httpServer.emit("connection", socket));
    server.on("tlsClientError", (err, socket) => {
        logger.debug(`[Paperboard Server] a TLS handshake from ${socket.remoteAddress ?? "an unknown address"} failed:`, err?.message ?? err);
    });
    return { server, http: httpServer };
}

/** Stops listening, and ends idle keep-alive connections as an https server's close() does, so they don't hold the close open. */
export function closeTlsListener(listener: TlsListener, callback?: (err?: Error) => void): void {
    listener.server.close(callback);
    listener.http.closeIdleConnections();
}
