import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PaperCraneEngine } from "./engine";
import { getDetailedOsInfo } from "./index";
import pkg from "../package.json";

import { lookupMime } from "./mime";
import {
    DAV_PREFIX,
    DavSessionStore,
    handleDavRequest,
    handleDavSessionIssue,
    handleDavSessionRevoke,
} from "./dav";
import type { PaperCraneAuth } from "./auth";

export interface HttpContext {
    auth?: PaperCraneAuth;
    sessions?: DavSessionStore;
}

// HTTP router for health, shutdown, and panel assets
export function handleHttpRequest(
    engine: PaperCraneEngine,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: HttpContext = {},
) {
    // no CORS by default, cross-origin browser reads denied

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const sessions = ctx.sessions ?? new DavSessionStore();

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

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // shutdown needs localhost plus custom header (blocks CSRF)
    if (pathname === "/shutdown" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "";
        const isLocal =
            ip === "127.0.0.1" ||
            ip === "::1" ||
            ip === "::ffff:127.0.0.1" ||
            ip.endsWith("127.0.0.1");

        const hasGuard =
            req.headers["x-papercrane-shutdown"] === "1";

        if (!isLocal || !hasGuard) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Shutdown not allowed" }));
            return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
        setTimeout(() => process.exit(0), 100);
        return;
    }

    // minimal health probe, no sensitive data
    if (pathname === "/health") {
        const osInfo = getDetailedOsInfo();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                status: "ok",
                service: "papercrane",
                version: pkg.version || "1.0.0",
                pid: process.pid,
                hostname: os.hostname().replace(/\.local$/i, ""),
                os: osInfo.os,
                osVersion: osInfo.osVersion,
                distroId: osInfo.distroId,
                distroName: osInfo.distroName,
                arch: process.arch,
            }),
        );
        return;
    }

    if (pathname.startsWith("/panel/")) {
        const parts = pathname.slice("/panel/".length).split("/");
        const panelId = parts[0];
        const subPath = parts.slice(1).join("/") || "index.html";

        const panelDir = engine.resolvePath("panels", panelId);
        if (!fs.existsSync(panelDir)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Panel Not Found");
            return;
        }

        const realPanelDir = path.resolve(panelDir);
        let filePath = path.resolve(path.join(realPanelDir, "dist", subPath));
        if (!fs.existsSync(filePath)) {
            filePath = path.resolve(path.join(realPanelDir, subPath));
        }
        if (!fs.existsSync(filePath) && subPath === "index.html") {
            filePath = path.resolve(path.join(realPanelDir, "dist", "index.html"));
        }

        const rel = path.relative(realPanelDir, filePath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("Forbidden: Path traversal outside panel directory");
            return;
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("File Not Found");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = lookupMime(ext);

        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
        };
        // baseline CSP: own origin plus inline, no remote scripts
        if (ext === ".html") {
            headers["Content-Security-Policy"] = [
                "default-src 'self' data: blob:",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https: http:",
                "font-src 'self' data:",
                "connect-src *",
                "media-src 'self' blob: https: http:",
                "frame-ancestors 'none'",
            ].join("; ");
        }

        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
}
