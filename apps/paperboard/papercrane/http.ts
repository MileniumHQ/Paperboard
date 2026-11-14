import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { PaperCraneEngine } from "./engine";
import { PAPERCRANE_VERSION } from "./discovery";

import { createHostAuthorityCheck } from "./hostAuthority";
import { isAllowedOrigin } from "./ws";

import { lookupMime } from "./mime";
import { buildPanelCsp } from "./panelNet";
import { resolveLocalPanelFile } from "./panelAssets";
import { isMissingPathError } from "./pathContainment";
import { DAV_PREFIX, handleDavRequest, handleDavSessionIssue, handleDavSessionRevoke, sendFileStream } from "./dav";
import { type DavSessionStore, isMainBearer } from "./davAuth";
import type { PaperCraneAuth } from "./auth";
import { handlePanelFileRequest, PANEL_FILES_PREFIX } from "./panelFiles";

export interface HttpContext {
    auth: PaperCraneAuth;
    sessions: DavSessionStore;
    allowsHost?: (authority: string | undefined) => boolean;
}

const allowsLoopbackHost = createHostAuthorityCheck();

// HTTP router for health, WebDAV, panel files and panel assets
export function handleHttpRequest(
    engine: PaperCraneEngine,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: HttpContext,
) {
    // no CORS by default, cross-origin browser reads denied

    // malformed Host (e.g. "Host: [") makes base-URL construction throw;
    // that must be a 400, never an uncaught exception that kills the daemon
    let pathname: string;
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        pathname = url.pathname;
    } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
        return;
    }
    if (!(ctx.allowsHost ?? allowsLoopbackHost)(req.headers.host)) {
        res.writeHead(421, { "Content-Type": "text/plain" });
        res.end("Misdirected Request");
        return;
    }
    if (ctx.auth.noAuth && req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Forbidden Origin");
        return;
    }
    const { sessions } = ctx;

    // WebDAV access plus session minting, matched before the prefix
    if (pathname === "/dav/session") {
        if ((req.method || "GET").toUpperCase() === "DELETE") {
            void handleDavSessionRevoke(sessions, ctx.auth, req, res);
        } else {
            void handleDavSessionIssue(sessions, ctx.auth, req, res);
        }
        return;
    }
    if (
        pathname === DAV_PREFIX ||
        pathname === `${DAV_PREFIX}/` ||
        pathname.startsWith(`${DAV_PREFIX}/`)
    ) {
        void handleDavRequest(engine, sessions, ctx.auth, req, res);
        return;
    }

    if (pathname.startsWith(PANEL_FILES_PREFIX)) {
        void handlePanelFileRequest(engine, ctx.auth, req, res);
        return;
    }

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // minimal health probe: liveness + version only. every other fact
    // (pid, hostname, OS) goes through authenticated RPC (system:info)
    if (pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                status: "ok",
                service: "papercrane",
                version: PAPERCRANE_VERSION,
            }),
        );
        return;
    }

    if (pathname.startsWith("/panel/")) {
        // panel assets are authenticated-only: same main-token Bearer check
        // as the DAV surface, so a LAN peer without the token learns
        // nothing about installed panels or their contents
        if (!isMainBearer(ctx.auth, req)) {
            res.writeHead(401, {
                "Content-Type": "text/plain",
                "WWW-Authenticate": 'Bearer realm="Paperboard Server"',
            });
            res.end("Unauthorized");
            return;
        }
        // the URL path is percent-encoded: a file named "my notes.html"
        // arrives as my%20notes.html. The resolver below refuses traversal
        // in the decoded path.
        let parts: string[];
        try {
            parts = pathname.slice("/panel/".length).split("/").map(decodeURIComponent);
        } catch {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Malformed panel file path");
            return;
        }
        const panelId = parts[0];
        const subPath = parts.slice(1).join("/") || "index.html";

        // one resolver for every panel-asset surface: the same function
        // the local panel:// protocol handler serves from
        // (papercrane/panelAssets.ts). No mirror, no drift.
        const resolution = resolveLocalPanelFile(
            engine.resolvePath("panels"),
            panelId,
            subPath,
        );
        if (resolution.kind === "invalid") {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Invalid panel id");
            return;
        }
        if (resolution.kind === "not-found") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("File Not Found");
            return;
        }
        if (resolution.kind === "forbidden") {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden: Path traversal outside panel directory");
            return;
        }
        const filePath = resolution.file;
        const ext = path.extname(filePath).toLowerCase();

        // the file is opened once and everything after reads that handle: a
        // panel update that removes it after resolution is a 404, never an
        // open that fails after the headers went out
        let fd: number;
        try {
            fd = fs.openSync(filePath, "r");
        } catch (err) {
            if (!isMissingPathError(err)) throw err;
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("File Not Found");
            return;
        }
        const body = fs.createReadStream(filePath, { fd, autoClose: true });
        const stat = fs.fstatSync(fd);

        // a panel's files change only when it's installed or updated, so a
        // client that has one asks again with its ETag and gets a 304
        // instead of the file (remote computers pay for every byte)
        const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && (ifNoneMatch.trim() === "*" || ifNoneMatch.split(",").some((tag) => tag.trim() === etag))) {
            body.destroy();
            res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
            res.end();
            return;
        }
        const headers: Record<string, string> = {
            "Content-Type": lookupMime(ext),
            "Content-Length": String(stat.size),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
            ETag: etag,
            "Last-Modified": stat.mtime.toUTCString(),
        };
        // one fixed panel CSP (panelNet) — same builder electron uses
        if (ext === ".html") {
            headers["Content-Security-Policy"] = [
                buildPanelCsp(),
                "frame-ancestors 'none'",
            ].join("; ");
        }

        res.writeHead(200, headers);
        sendFileStream(res, body);
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
}
