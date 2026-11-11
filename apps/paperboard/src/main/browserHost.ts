// Paperboard in the browser: the shell served to the person's own browser
// instead of an Electron window. "Open in Browser" in the tray and `--web`
// open it; `--browser` serves it for development without opening a tab.
// This module is the HTTP host for it and imports nothing from Electron;
// the caller supplies the handlers.
//
// Sign-in (browserSessions.ts): Paperboard opens a link that works once,
// for a few minutes, and that gives the browser a session cookie. Without
// that cookie nothing but the signed-out page and the shell's own static
// files is served: no bridge, no events, no panels, no crane credentials.
//
// Everything is on one origin, as on Paperboard web; panels are trusted
// and share it:
//   shell   http://localhost:<port>/
//   panels  http://localhost:<port>/_panel/<computerId>/<panelId>/
//
// It binds to 127.0.0.1 only. The Host header must be ours (DNS-rebinding
// defense), and the shell bridge must carry the exact shell Origin, so
// another site's page cannot drive it even with the cookie attached.
import * as http from "http";
import type { Readable } from "stream";
import { pipeline } from "stream/promises";
import { PANEL_PATH_ROOT, parsePanelPath } from "../../../../packages/paperapi/src/panelPath";
import { logger } from "../../papercrane/logger";
import type { BrowserSessions } from "./browserSessions";
import { readShellFile } from "./shellAssets";

// Every browser resolves localhost to this machine, Safari included, and
// treats it as a secure context.
export const BROWSER_HOST_NAME = "localhost";
// the page a browser without a session lands on
export const SIGNED_OUT_PAGE = "/signed-out.html";
export const SIGN_IN_PATH = "/_shell/sign-in";

// a Host header that names this machine some other way than our canonical
// name; the request is sent to the canonical origin, the one the bridge's
// Origin check and the session cookie expect
function isLoopbackAlias(host: string): boolean {
    const bare = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    return bare === "127.0.0.1" || bare === "::1" || bare === "paperboard.localhost";
}

// Cookies ignore ports, so each port gets its own name: the installed app
// and a development build on another port keep separate sessions.
export const sessionCookieName = (port: number) => `pb_session_${port}`;

function readCookie(req: http.IncomingMessage, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
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
    sessions: BrowserSessions;
    // built renderer (out/renderer); ignored when rendererDevUrl is set
    rendererDir?: string;
    // dev: proxy shell documents to the renderer dev server
    rendererDevUrl?: string;
    invoke: Record<string, (args: unknown) => unknown>;
    send?: Record<string, (...args: unknown[]) => void>;
    servePanel: (computerId: string, panelId: string, pathname: string) => Promise<Response>;
    // a panel's save and open dialogs run in the browser; these move the
    // bytes. Failures throw an error carrying a `code` the renderer reports.
    panelFiles?: {
        stat(args: unknown): Promise<{ size: number }>;
        read(args: unknown): Promise<{ size: number; body: Readable }>;
        write(args: unknown, body: Readable, size: number): Promise<unknown>;
    };
}

export interface BrowserHost {
    readonly port: number;
    readonly origin: string;
    /** a link that signs one browser in, once, for the next few minutes */
    signInUrl(): string;
    push(channel: string, payload: unknown): void;
    close(): Promise<void>;
}

// types a browser renders as a page with scripts when opened directly
const DOCUMENT_TYPE = /^\s*(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|[^;]*\+xml)\s*(;|$)/i;

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

    const sessionToken = (req: http.IncomingMessage) => readCookie(req, sessionCookieName(port));
    const signedIn = (req: http.IncomingMessage) => opts.sessions.isSignedIn(sessionToken(req));
    const assertSignedIn = (req: http.IncomingMessage) => {
        if (!signedIn(req)) {
            throw new HttpError(401, "Sign in to Paperboard in the browser: open it from Paperboard (Open in Browser in its tray menu, or paperboard --web).");
        }
    };
    const redirect = (res: http.ServerResponse, status: 302 | 303, location: string, extra: Record<string, string> = {}) => {
        res.writeHead(status, { location, "cache-control": "no-store", ...extra });
        res.end();
    };

    // GET /_shell/sign-in?link=<token>: the link Paperboard opened. It works
    // once; the browser keeps a session cookie and lands on the shell with
    // the link gone from its address bar.
    const handleSignIn = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
        if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
        const signed = opts.sessions.redeemSignInLink(url.searchParams.get("link"));
        if (!signed) {
            logger.warn("[BrowserHost] a sign-in link was refused: unknown, used, or expired");
            return redirect(res, 303, `${SIGNED_OUT_PAGE}?reason=link`);
        }
        const maxAge = Math.floor((signed.expiresAt - Date.now()) / 1000);
        redirect(res, 303, "/", {
            "set-cookie": `${sessionCookieName(port)}=${signed.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
            "referrer-policy": "no-referrer",
        });
    };

    const handleSignOut = (req: http.IncomingMessage, res: http.ServerResponse) => {
        assertShellCaller(req);
        opts.sessions.signOut(sessionToken(req));
        res.writeHead(204, {
            "cache-control": "no-store",
            "set-cookie": `${sessionCookieName(port)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        });
        res.end();
    };

    // bridge calls must come from this host's own pages, never another site
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

    const failPanelFile = (res: http.ServerResponse, err: any) => {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        const code = typeof err?.code === "string" ? err.code : "failed";
        sendJson(res, code === "invalid-request" ? 400 : 409, { status: "failed", code, message: err?.message || String(err) });
    };

    // shell origin only, like the bridge; the bytes never pass the JSON cap
    const handlePanelFileRead = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        assertShellCaller(req);
        if (!opts.panelFiles) throw new HttpError(404, "Panel files are not available");
        const args = await readJsonBody(req);
        let file: { size: number; body: Readable };
        try {
            file = await opts.panelFiles.read(args);
        } catch (err) {
            logger.debug("[BrowserHost] panel file read refused:", (err as Error)?.message ?? err);
            failPanelFile(res, err);
            return;
        }
        res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            ...(Number.isFinite(file.size) ? { "Content-Length": String(file.size) } : {}),
        });
        // a tab that goes away cancels the daemon side too
        await pipeline(file.body, res).catch((err) => {
            logger.debug("[BrowserHost] panel file read ended:", err?.message || err);
            res.destroy();
        });
    };

    const handlePanelFileStat = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        assertShellCaller(req);
        if (!opts.panelFiles) throw new HttpError(404, "Panel files are not available");
        const args = await readJsonBody(req);
        try {
            sendJson(res, 200, await opts.panelFiles.stat(args));
        } catch (err) {
            failPanelFile(res, err);
        }
    };

    const handlePanelFileWrite = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
        if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
        if (req.headers.origin !== origin) throw new HttpError(403, "Shell bridge is shell-origin only");
        if (!opts.panelFiles) throw new HttpError(404, "Panel files are not available");
        const size = Number(req.headers["content-length"]);
        if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(411, "A file upload needs a Content-Length");
        let args: unknown;
        try {
            args = JSON.parse(url.searchParams.get("request") || "null");
        } catch (err) {
            throw new HttpError(400, `Invalid request parameter: ${String(err)}`);
        }
        try {
            sendJson(res, 200, await opts.panelFiles.write(args, req, size));
        } catch (err) {
            req.resume();
            failPanelFile(res, err);
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
        // EventSource from this host's own pages is same-origin
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
        if (url.pathname === SIGN_IN_PATH) return handleSignIn(req, res, url);
        // the shell's files are public; what they reach is not
        if (url.pathname.startsWith("/_shell/") || url.pathname.startsWith(PANEL_PATH_ROOT)) assertSignedIn(req);
        if (url.pathname.startsWith(PANEL_PATH_ROOT)) return handlePanel(req, res, url);
        if (url.pathname === "/_shell/sign-out") return handleSignOut(req, res);
        if (url.pathname.startsWith("/_shell/invoke/")) {
            return handleInvoke(url.pathname.slice("/_shell/invoke/".length), req, res);
        }
        if (url.pathname.startsWith("/_shell/send/")) {
            return handleSend(url.pathname.slice("/_shell/send/".length), req, res);
        }
        if (url.pathname === "/_shell/events") return handleEvents(req, res);
        if (url.pathname === "/_shell/panel-file/stat") return handlePanelFileStat(req, res);
        if (url.pathname === "/_shell/panel-file/read") return handlePanelFileRead(req, res);
        if (url.pathname === "/_shell/panel-file/write") return handlePanelFileWrite(req, res, url);
        if (url.pathname.startsWith("/_shell/")) throw new HttpError(404, "Not found");
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
        // the shell document needs a session; the signed-out page needs none
        if (url.pathname === "/" || url.pathname === "/index.html") {
            if (!signedIn(req)) return redirect(res, 302, SIGNED_OUT_PAGE);
        } else if (url.pathname === SIGNED_OUT_PAGE && !url.search && signedIn(req)) {
            return redirect(res, 302, "/");
        }
        if (opts.rendererDevUrl) return proxyRenderer(req, res, opts.rendererDevUrl);
        return serveRendererFile(url.pathname, res);
    };

    const handlePanel = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
        if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed");
        // a service worker would keep answering for the panel's folder
        // after the browser signs out. No panel uses one.
        if (req.headers["service-worker"] === "script") throw new HttpError(403, "Panels can't register service workers in the browser");
        const scope = parsePanelPath(url.pathname);
        if (!scope) throw new HttpError(404, "Not a panel's address: /_panel/<computerId>/<panelId>/");
        const answer = await opts.servePanel(scope.computerId, scope.panelId, scope.subpath);
        const headers: Record<string, string | string[]> = {};
        answer.headers.forEach((value, key) => {
            headers[key] = value;
        });
        // panel documents live inside the shell only; a second CSP header
        // adds the restriction without touching the served policy
        const policies = [headers["content-security-policy"] as string | undefined, "frame-ancestors 'self'"];
        // anything but the panel's HTML that a browser would open as a page
        // (SVG, XML, HTML under another name) would otherwise run on the
        // shell's origin unchecked; the sandbox gives it an origin of its own
        if (!/\.html?$/i.test(scope.subpath || "index.html") && DOCUMENT_TYPE.test(String(headers["content-type"] ?? ""))) {
            policies.push("sandbox");
        }
        headers["content-security-policy"] = policies.filter((p): p is string => Boolean(p));
        headers["referrer-policy"] = "no-referrer";
        const body = Buffer.from(await answer.arrayBuffer());
        res.writeHead(answer.status, headers);
        res.end(req.method === "HEAD" ? undefined : body);
    };

    const server = http.createServer((req, res) => {
        const host = String(req.headers.host || "").toLowerCase();
        // a malformed request target (e.g. "//[") makes URL construction
        // throw; that must be a 400, never an uncaught exception that leaves
        // the socket hanging. A foreign Host is refused below (421).
        let url: URL;
        try {
            url = new URL(req.url || "/", `http://${shellHost}`);
        } catch {
            logger.debug("[BrowserHost] malformed request target:", req.url);
            sendText(res, 400, "Bad Request");
            return;
        }
        let work: Promise<void> | void;
        if (host === shellHost) {
            work = handleShell(req, res, url);
        } else if (isLoopbackAlias(host) && host.endsWith(`:${port}`)) {
            // 127.0.0.1 / [::1] is how someone reaches the port when they
            // were only told the number. Redirect to the canonical origin,
            // the one the session cookie and the bridge's Origin check
            // expect; never serve content under a foreign Host.
            redirect(res, 302, `http://${shellHost}${url.pathname}${url.search}`);
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
            shellHost = `${BROWSER_HOST_NAME}:${port}`;
            origin = `http://${shellHost}`;
            resolve({
                port,
                origin,
                signInUrl: () => `${origin}${SIGN_IN_PATH}?link=${opts.sessions.issueSignInLink()}`,
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
