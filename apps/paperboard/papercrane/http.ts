import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { PaperCraneEngine } from "./engine";
import pkg from "../package.json";

import { lookupMime } from "./mime";
import { buildPanelCsp } from "./panelNet";
import { resolveLocalPanelFile } from "./panelAssets";
import {
    DAV_PREFIX,
    DavSessionStore,
    handleDavRequest,
    handleDavSessionIssue,
    handleDavSessionRevoke,
    isMainBearer,
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

    // shutdown needs localhost plus custom header (blocks CSRF) plus a
    // valid bearer token: killing the daemon (and every supervised child
    // via the exit hooks) is irreversible destruction on a single RPC, and
    // a one-byte magic header is not a credential. Same main-token Bearer
    // check as the /panel/ surface.
    if (pathname === "/shutdown" && req.method === "POST") {
        const ip = req.socket.remoteAddress || "";
        const isLocal =
            ip === "127.0.0.1" ||
            ip === "::1" ||
            ip === "::ffff:127.0.0.1" ||
            ip.endsWith("127.0.0.1");

        const hasGuard =
            req.headers["x-papercrane-shutdown"] === "1";

        if (!isLocal || !hasGuard || !isMainBearer(ctx.auth, req)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Shutdown not allowed" }));
            return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pid: process.pid }));
        setTimeout(() => process.exit(0), 100);
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
                version: pkg.version || "1.0.0",
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
                "WWW-Authenticate": 'Bearer realm="PaperCrane"',
            });
            res.end("Unauthorized");
            return;
        }
        const parts = pathname.slice("/panel/".length).split("/");
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
        const contentType = lookupMime(ext);

        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
        };
        // panel CSP derives from the panel's declared network egress
        // (panelNet) — same builder electron uses, one source of truth
        if (ext === ".html") {
            headers["Content-Security-Policy"] = [
                buildPanelCsp(panelId),
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
