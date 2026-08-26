import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PaperCraneEngine } from "./engine";
import { getDetailedOsInfo } from "./index";
import pkg from "../package.json";

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
};

// HTTP router handling health check, graceful shutdown, and panel static asset serving
export function handleHttpRequest(
    engine: PaperCraneEngine,
    req: http.IncomingMessage,
    res: http.ServerResponse,
) {
    // No CORS by default: all first-party consumers are non-browser clients
    // or same-origin panel:// loads. Cross-origin browser reads are denied.

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Shutdown endpoint — localhost only AND requires the custom header so
    // a malicious website cannot CSRF it (custom headers require preflight,
    // which this server never grants).
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

    // Health probe endpoint — deliberately minimal: no username, no LAN IP
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

    // Panel asset serving
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
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
        };
        // Baseline CSP for panel documents: scripts may only come from the
        // panel's own origin (inline allowed — panels are vite-built apps).
        // Remote script injection is blocked; API calls remain possible.
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
