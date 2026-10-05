// Browser mode (`--browser`): the shell runs in the user's own browser
// instead of an Electron window. This module is the HTTP host for it and
// imports nothing from Electron; the caller supplies the handlers.
//
// THIS IS A DEV TOOL. There is no sign-in: the loopback port is served to
// any local client, and a panel document carries a freshly issued panel
// token, so anything that can reach the port can reach the daemon. It binds
// to 127.0.0.1 only and must never be exposed on a network interface. Two
// checks remain even in this mode: the Host header must be ours
// (DNS-rebinding defense) and the shell bridge must carry the exact shell
// Origin (a panel frame, same-site but a different origin, cannot call
// shell-only channels).
//
// Origins mirror the Electron layout so panels keep their isolation:
//   shell   http://paperboard.localhost:<port>/
//   panels  http://<computerId>.<panelId>.paperboard.localhost:<port>/
// Browsers resolve *.localhost to loopback and treat it as a secure context.
import * as http from "http";
import { logger } from "../../papercrane/logger";
import { parsePanelHost } from "./panelAssets";
import { readShellFile } from "./shellAssets";

export const BROWSER_HOST_SUFFIX = "paperboard.localhost";

// a Host header that is a plain loopback alias rather than our canonical name
function isLoopbackAlias(host: string): boolean {
    const bare = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

// bounds: tabs listening for pushes, bridge bodies
export const MAX_EVENT_CLIENTS = 16;
export const MAX_BRIDGE_BODY_BYTES = 64 * 1024;
// a tab that stops reading its stream is dropped, not buffered without bound
export const MAX_EVENT_BACKLOG_BYTES = 1024 * 1024;
const EVENT_HEARTBEAT_MS = 25_000;

export interface BrowserHostOptions {
    // 0 picks a free port
    port: number;
    // built renderer (out/renderer); ignored when rendererDevUrl is set
    rendererDir?: string;
    // dev: proxy shell documents to the renderer dev server
    rendererDevUrl?: string;
    invoke: Record<string, (args: unknown) => unknown>;
    send?: Record<string, (...args: unknown[]) => void>;
    servePanel: (computerId: string, panelId: string, pathname: string) => Promise<Response>;
}

export interface BrowserHost {
    readonly port: number;
    readonly origin: string;
    push(channel: string, payload: unknown): void;
    close(): Promise<void>;
}

class HttpError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BRIDGE_BODY_BYTES) {
                reject(new HttpError(413, "Request body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            if (size === 0) return resolve(undefined);
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (err) {
                reject(new HttpError(400, `Invalid JSON body: ${String(err)}`));
            }
        });
        req.on("error", reject);
    });
}

function sendText(res: http.ServerResponse, status: number, text: string, extra: Record<string, string> = {}) {
    res.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extra,
    });
    res.end(text);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
}


export function startBrowserHost(opts: BrowserHostOptions): Promise<BrowserHost> {
    const eventClients = new Set<http.ServerResponse>();
    let port = 0;
    let shellHost = "";
    let origin = "";
    let closed = false;

    // bridge calls must come from the shell document itself: a panel frame
    // is same-site but a different Origin, so it cannot call shell channels
    const assertShellCaller = (req: http.IncomingMessage) => {
        if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
        if (req.headers.origin !== origin) throw new HttpError(403, "Shell bridge is shell-origin only");
        if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
            throw new HttpError(415, "Bridge requests are JSON");
        }
    };

    const handleInvoke = async (channel: string, req: http.IncomingMessage, res: http.ServerResponse) => {
        assertShellCaller(req);
        const handler = Object.hasOwn(opts.invoke, channel) ? opts.invoke[channel] : undefined;
        if (!handler) throw new HttpError(404, `Channel not available in browser mode: ${channel}`);
        const body = (await readJsonBody(req)) as { args?: unknown[] } | undefined;
        const args = Array.isArray(body?.args) ? body.args : [];
        try {
            sendJson(res, 200, { ok: true, result: await handler(args[0]) });
        } catch (err: any) {
            // a handler failure is an answer the renderer must see as a
            // rejected invoke, same as Electron IPC
            sendJson(res, 200, { ok: false, error: err?.message || String(err) });
        }
    };

    const handleSend = async (channel: string, req: http.IncomingMessage, res: http.ServerResponse) => {
        assertShellCaller(req);
        const handler = opts.send && Object.hasOwn(opts.send, channel) ? opts.send[channel] : undefined;
        if (!handler) throw new HttpError(404, `Channel not available in browser mode: ${channel}`);
        const body = (await readJsonBody(req)) as { args?: unknown[] } | undefined;
        handler(...(Array.isArray(body?.args) ? body.args : []));
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
    };

    const handleEvents = (req: http.IncomingMessage, res: http.ServerResponse) => {
        // EventSource from the shell is same-origin; a panel frame's is not
        const site = req.headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin") {
            throw new HttpError(403, "Shell events are shell-origin only");
        }
        if (eventClients.size >= MAX_EVENT_CLIENTS) {
            throw new HttpError(503, "Too many open Paperboard tabs");
        }
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
        });
        res.write(": connected\n\n");
        eventClients.add(res);
        const drop = () => eventClients.delete(res);
        req.on("close", drop);
        res.on("error", drop);
    };

    const writeEvent = (client: http.ServerResponse, frame: string) => {
        if (client.writableLength > MAX_EVENT_BACKLOG_BYTES) {
            eventClients.delete(client);
            client.destroy();
            return;
        }
        client.write(frame);
    };

    const serveRendererFile = async (pathname: string, res: http.ServerResponse) => {
        if (!opts.rendererDir) throw new HttpError(404, "Not found");
        const file = await readShellFile(opts.rendererDir, pathname);
        if (!file.ok) throw new HttpError(file.status, file.status === 403 ? "Forbidden" : file.status === 400 ? "Bad request" : "Not found");
        res.writeHead(200, file.headers);
        res.end(file.data);
    };

    const proxyRenderer = (req: http.IncomingMessage, res: http.ServerResponse, devUrl: string) =>
        new Promise<void>((resolve, reject) => {
            // the request path is appended to the dev origin as text: URL
            // resolution would let "//other-host/x" or an absolute-form
            // request line pick the upstream host
            const rawPath = req.url || "/";
            if (!rawPath.startsWith("/")) {
                reject(new HttpError(400, "Malformed request path"));
                return;
            }
            const target = new URL(new URL(devUrl).origin + rawPath);
            const upstream = http.request(
                target,
                {
                    method: "GET",
                    // the dev server checks Host; the session cookie stays here
                    headers: { ...req.headers, host: target.host, cookie: "" },
                },
                (up) => {
                    res.writeHead(up.statusCode || 502, {
                        ...up.headers,
                        "content-security-policy": "frame-ancestors 'none'",
                    });
                    up.pipe(res);
                    up.on("end", resolve);
                    up.on("error", reject);
                },
            );
            upstream.on("error", reject);
            res.on("close", () => upstream.destroy());
            upstream.end();
        });

    const handleShell = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
        if (url.pathname.startsWith("/_shell/invoke/")) {
            return handleInvoke(url.pathname.slice("/_shell/invoke/".length), req, res);
        }
        if (url.pathname.startsWith("/_shell/send/")) {
            return handleSend(url.pathname.slice("/_shell/send/".length), req, res);
        }
        if (url.pathname === "/_shell/events") return handleEvents(req, res);
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
        if (opts.rendererDevUrl) return proxyRenderer(req, res, opts.rendererDevUrl);
        return serveRendererFile(url.pathname, res);
    };

    const handlePanel = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, prefix: string) => {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
        const scope = parsePanelHost(prefix);
        if (!scope) throw new HttpError(400, "Malformed panel URL: missing computer scope prefix");
        const answer = await opts.servePanel(scope.comp, scope.panelId, url.pathname);
        const headers: Record<string, string | string[]> = {};
        answer.headers.forEach((value, key) => {
            headers[key] = value;
        });
        // panel documents live inside the shell only; a second CSP header
        // adds the restriction without touching the served policy
        const csp = headers["content-security-policy"];
        const frameAncestors = `frame-ancestors ${origin}`;
        headers["content-security-policy"] = csp ? [csp as string, frameAncestors] : frameAncestors;
        headers["referrer-policy"] = "no-referrer";
        const body = Buffer.from(await answer.arrayBuffer());
        res.writeHead(answer.status, headers);
        res.end(req.method === "HEAD" ? undefined : body);
    };

    const server = http.createServer((req, res) => {
        const host = String(req.headers.host || "").toLowerCase();
        const url = new URL(req.url || "/", `http://${shellHost}`);
        let work: Promise<void> | void;
        if (host === shellHost) {
            work = handleShell(req, res, url);
        } else if (host.endsWith(`.${shellHost}`)) {
            work = handlePanel(req, res, url, host.slice(0, -(shellHost.length + 1)));
        } else if (isLoopbackAlias(host)) {
            // A loopback alias (localhost / 127.0.0.1 / ::1) is how someone
            // reaches the port when they were only told the number. Redirect
            // to the canonical origin so the session cookie (Domain=
            // paperboard.localhost) and the panel origins line up; never
            // serve content under a foreign Host.
            res.writeHead(302, { location: `http://${shellHost}${req.url || "/"}` });
            res.end();
            work = Promise.resolve();
        } else {
            // not our name: a rebinding page or a stray client
            work = sendText(res, 421, "Misdirected request");
        }
        void Promise.resolve(work).catch((err: any) => {
            const status = err instanceof HttpError ? err.status : 500;
            if (status === 500) logger.error("[BrowserHost] request failed:", err?.message || err);
            if (res.headersSent) {
                res.destroy();
                return;
            }
            sendText(res, status, err?.message || "Internal error");
        });
    });

    const heartbeat = setInterval(() => {
        for (const client of eventClients) writeEvent(client, ": ping\n\n");
    }, EVENT_HEARTBEAT_MS);
    heartbeat.unref?.();

    return new Promise((resolve, reject) => {
        server.once("error", (err) => {
            clearInterval(heartbeat);
            reject(err);
        });
        server.listen(opts.port, "127.0.0.1", () => {
            const address = server.address();
            port = typeof address === "object" && address ? address.port : opts.port;
            shellHost = `${BROWSER_HOST_SUFFIX}:${port}`;
            origin = `http://${shellHost}`;
            logger.warn(
                `[Browser] DEV TOOL: Paperboard browser mode is serving ${origin} with no sign-in. ` +
                    "THIS IS A DEV TOOL AND SHOULD NOT BE USED for anything but development on a trusted machine.",
            );
            resolve({
                port,
                origin,
                push(channel, payload) {
                    const frame = `event: ${channel}\ndata: ${JSON.stringify(payload ?? null)}\n\n`;
                    for (const client of eventClients) writeEvent(client, frame);
                },
                close() {
                    if (closed) return Promise.resolve();
                    closed = true;
                    clearInterval(heartbeat);
                    for (const client of eventClients) client.end();
                    eventClients.clear();
                    return new Promise<void>((done) => {
                        server.close(() => done());
                        server.closeAllConnections();
                    });
                },
            });
        });
    });
}
