// Loopback WebDAV relay for opening a remote computer's folder on Linux.
//
// The file manager is handed a plain URL to 127.0.0.1 with no
// credential in it; this relay adds the DAV session's Basic auth on the way
// to the remote daemon. That keeps the session password out of argv (ps),
// out of the file manager's history/recent files, and works on any desktop
// whose file manager speaks WebDAV (GNOME dav://, KDE webdav://).
//
// A loopback port is reachable by every local account, so a connection is
// only served when the kernel says its client socket belongs to this user
// (/proc/net/tcp owner uid). Anything else is dropped before a byte of
// HTTP is parsed. No Electron imports: tests drive the real relay.
import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import { logger } from "../../papercrane/logger";

// bounds: open client connections, and how long a quiet relay lives
export const MAX_RELAY_CONNECTIONS = 32;
const UPSTREAM_TIMEOUT_MS = 60_000;

// hop-by-hop headers never cross a proxy (RFC 9110 §7.6.1); authorization
// is ours to set, host is the upstream's
const DROP_REQUEST_HEADERS = new Set([
    "authorization",
    "host",
    "connection",
    "keep-alive",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "upgrade",
]);
const DROP_RESPONSE_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "trailer",
    "upgrade",
    // the relay holds the credential: a challenge would make the file
    // manager prompt for a password the user does not have
    "www-authenticate",
]);

/**
 * Owner uid of the client end of a loopback TCP connection, from the text
 * of /proc/net/tcp or /proc/net/tcp6. The client socket is the row whose
 * local port is the connection's remote port and whose remote port is the
 * relay's port. null when no row matches.
 */
export function socketOwnerUid(procNetTcp: string, clientPort: number, serverPort: number): number | null {
    for (const line of procNetTcp.split("\n").slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 8) continue;
        const localPort = Number.parseInt(cols[1].split(":").pop() ?? "", 16);
        const remotePort = Number.parseInt(cols[2].split(":").pop() ?? "", 16);
        if (localPort === clientPort && remotePort === serverPort) {
            const uid = Number(cols[7]);
            return Number.isInteger(uid) ? uid : null;
        }
    }
    return null;
}

async function peerIsCurrentUser(socket: net.Socket): Promise<boolean> {
    const uid = process.getuid?.();
    if (uid === undefined || !socket.remotePort || !socket.localPort) return false;
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        let text: string;
        try {
            text = await fs.promises.readFile(file, "utf8");
        } catch (err: any) {
            // tcp6 is absent on kernels without IPv6; tcp missing is fatal
            if (file.endsWith("6") && err?.code === "ENOENT") continue;
            logger.warn(`[DavRelay] cannot read ${file}; refusing connection:`, err?.message ?? err);
            return false;
        }
        const owner = socketOwnerUid(text, socket.remotePort, socket.localPort);
        if (owner !== null) return owner === uid;
    }
    return false;
}

export interface DavRelayOptions {
    /** remote daemon origin, e.g. http://192.168.1.4:45464 */
    upstream: string;
    user: string;
    pass: string;
    /** quiet time after which the relay closes itself and calls onIdle */
    idleMs: number;
    onIdle: () => void;
    /** test seam only: production always checks the socket owner */
    verifyPeer?: (socket: net.Socket) => Promise<boolean>;
}

export interface DavRelay {
    readonly port: number;
    close(): Promise<void>;
}

export function startDavRelay(opts: DavRelayOptions): Promise<DavRelay> {
    const upstream = new URL(opts.upstream);
    const authorization = `Basic ${Buffer.from(`${opts.user}:${opts.pass}`).toString("base64")}`;
    const verifyPeer = opts.verifyPeer ?? peerIsCurrentUser;
    const sockets = new Set<net.Socket>();
    let idleTimer: NodeJS.Timeout | null = null;
    let closed = false;
    let port = 0;

    const touch = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            logger.info("[DavRelay] idle; closing");
            void relay.close().finally(() => opts.onIdle());
        }, opts.idleMs);
        idleTimer.unref?.();
    };

    const httpServer = http.createServer((req, res) => {
        touch();
        const headers: http.OutgoingHttpHeaders = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined || DROP_REQUEST_HEADERS.has(key)) continue;
            headers[key] = value;
        }
        headers.host = upstream.host;
        headers.authorization = authorization;
        // MOVE/COPY name their target by absolute URL on the relay's origin
        if (typeof headers.destination === "string") {
            try {
                const dest = new URL(headers.destination);
                headers.destination = `${upstream.origin}${dest.pathname}${dest.search}`;
            } catch {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Bad Destination");
                return;
            }
        }
        const out = http.request(
            {
                protocol: upstream.protocol,
                hostname: upstream.hostname,
                port: upstream.port,
                method: req.method,
                path: req.url,
                headers,
                timeout: UPSTREAM_TIMEOUT_MS,
            },
            (up) => {
                const back: http.OutgoingHttpHeaders = {};
                for (const [key, value] of Object.entries(up.headers)) {
                    if (value === undefined || DROP_RESPONSE_HEADERS.has(key)) continue;
                    back[key] = value;
                }
                res.writeHead(up.statusCode ?? 502, back);
                up.pipe(res);
                up.on("error", () => res.destroy());
            },
        );
        out.on("timeout", () => out.destroy(new Error("upstream timed out")));
        out.on("error", (err) => {
            logger.warn("[DavRelay] upstream request failed:", err.message);
            if (!res.headersSent) {
                res.writeHead(502, { "Content-Type": "text/plain" });
                res.end("The remote computer did not answer");
            } else {
                res.destroy();
            }
        });
        // a client that goes away cancels the upstream request too
        res.on("close", () => {
            if (!res.writableFinished) out.destroy();
        });
        req.pipe(out);
    });

    const gate = net.createServer((socket) => {
        if (closed || sockets.size >= MAX_RELAY_CONNECTIONS) {
            socket.destroy();
            return;
        }
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.pause();
        verifyPeer(socket).then(
            (ok) => {
                if (!ok || closed) {
                    logger.warn("[DavRelay] refused a connection from another user");
                    socket.destroy();
                    return;
                }
                httpServer.emit("connection", socket);
                socket.resume();
            },
            (err) => {
                logger.warn("[DavRelay] peer check failed; refusing:", err?.message ?? err);
                socket.destroy();
            },
        );
    });

    const relay: DavRelay = {
        get port() {
            return port;
        },
        close() {
            if (closed) return Promise.resolve();
            closed = true;
            if (idleTimer) clearTimeout(idleTimer);
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            return new Promise<void>((done) => gate.close(() => done()));
        },
    };

    return new Promise((resolve, reject) => {
        gate.once("error", reject);
        gate.listen(0, "127.0.0.1", () => {
            const address = gate.address();
            port = typeof address === "object" && address ? address.port : 0;
            touch();
            resolve(relay);
        });
    });
}

/**
 * The URL a Linux file manager opens for the relay. KDE's KIO names WebDAV
 * webdav://; GNOME (gvfs) and most others use dav://.
 */
export function relayFolderUrl(desktop: string | undefined, port: number, subDir: string): string {
    const scheme = /\bKDE\b/i.test(desktop ?? "") ? "webdav" : "dav";
    const path = subDir
        ? subDir
              .split("/")
              .filter(Boolean)
              .map((seg) => encodeURIComponent(seg))
              .join("/") + "/"
        : "";
    return `${scheme}://127.0.0.1:${port}/dav/${path}`;
}
