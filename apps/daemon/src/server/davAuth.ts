// Who may use WebDAV: the main token, or an ephemeral session minted with
// it (Basic user and password a mounted drive keeps), and the session store.
import * as crypto from "crypto";
import type * as http from "http";
import type { PaperCraneAuth } from "../security/auth";
import { secretsMatch } from "../security/secretCompare";
import { logger } from "../core/logger";

export const DAV_REALM = "Paperboard Server";
export const DEFAULT_IDLE_MS = 5 * 60_000;
const MIN_IDLE_MS = 30_000;
const MAX_IDLE_MS = 30 * 60_000;

export interface DavSession {
    user: string;
    pass: string;
    createdAt: number;
    lastActiveAt: number;
    idleMs: number;
    issuerToken?: string;
}

export class DavSessionStore {
    private byUser = new Map<string, DavSession>();
    private secrets = new Set<string>();

    issue(idleMs = DEFAULT_IDLE_MS, issuerToken?: string): DavSession {
        this.sweep();
        const clamped = Math.min(MAX_IDLE_MS, Math.max(MIN_IDLE_MS, idleMs));
        const now = Date.now();
        const s: DavSession = {
            user: `dav-${crypto.randomBytes(6).toString("hex")}`,
            pass: crypto.randomBytes(24).toString("hex"),
            createdAt: now,
            lastActiveAt: now,
            idleMs: clamped,
            issuerToken,
        };
        this.byUser.set(s.user, s);
        this.secrets.add(s.pass);
        this.sweep();
        return s;
    }

    revoke(user: string): boolean {
        const s = this.byUser.get(user);
        if (!s) return false;
        this.byUser.delete(user);
        this.secrets.delete(s.pass);
        return true;
    }

    revokeAll(): void {
        this.byUser.clear();
        this.secrets.clear();
    }

    isSessionSecret(secret: string): boolean {
        return this.secrets.has(secret);
    }

    /** Session for Basic user+pass, or null */
    useBasic(user: string, pass: string, auth?: PaperCraneAuth): DavSession | null {
        const s = this.byUser.get(user);
        if (!s) return null;
        if (s.issuerToken && !auth?.verifyHostToken(s.issuerToken)) {
            this.revoke(user);
            return null;
        }
        if (Date.now() - s.lastActiveAt > s.idleMs) {
            this.revoke(user);
            return null;
        }
        if (!secretsMatch(s.pass, pass)) return null;
        s.lastActiveAt = Date.now();
        return s;
    }

    sweep(): void {
        const now = Date.now();
        for (const [user, s] of this.byUser) {
            if (now - s.lastActiveAt > s.idleMs) {
                this.byUser.delete(user);
                this.secrets.delete(s.pass);
            }
        }
    }
}

export interface DavCredential {
    kind: "main" | "session";
}

export function parseBasic(header: string): { user: string; pass: string } | null {
    // runs before authentication on attacker-sized input: plain slicing, no
    // backtracking pattern
    const value = header.trim();
    if (value.slice(0, 5).toLowerCase() !== "basic" || !/^\s/.test(value.slice(5, 6))) return null;
    const token = value.slice(5).trimStart();
    if (!token) return null;
    let decoded: string;
    try {
        decoded = Buffer.from(token, "base64").toString("utf-8");
    } catch (err) {
        logger.debug("[dav] basic-auth decode failed:", err);
        return null;
    }
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/** Main-token check without the lastSeen write */
function isMainToken(auth: PaperCraneAuth | undefined, secret: string): boolean {
    if (!auth || !secret) return false;
    if (auth.noAuth) return true;
    try {
        // hash-index lookup + one constant-time compare (auth.matchToken),
        // no per-entry scan
        return auth.verifyHostToken(secret);
    } catch (err) {
        logger.debug("[dav] main-token check failed:", err);
        return false;
    }
}

export function checkDavAuth(
    auth: PaperCraneAuth | undefined,
    sessions: DavSessionStore,
    req: http.IncomingMessage,
): DavCredential | null {
    const header = req.headers.authorization;
    if (!header) return null;
    if (/^Bearer\s+/i.test(header)) {
        const token = header.replace(/^Bearer\s+/i, "").trim();
        if (sessions.isSessionSecret(token)) return null; // sessions can't mint
        return isMainToken(auth, token) ? { kind: "main" } : null;
    }
    const basic = parseBasic(header);
    if (!basic) return null;
    if (sessions.useBasic(basic.user, basic.pass, auth)) return { kind: "session" };
    if (sessions.isSessionSecret(basic.pass)) return null;
    return isMainToken(auth, basic.pass) ? { kind: "main" } : null;
}

export function davUnauthorized(res: http.ServerResponse): void {
    res.writeHead(401, {
        "Content-Type": "text/plain",
        "WWW-Authenticate": `Basic realm="${DAV_REALM}"`,
    });
    res.end("Unauthorized");
}

// main-token Bearer check for non-DAV surfaces (panel assets): ephemeral
// DAV session secrets are never accepted here, same as session minting
export function isMainBearer(
    auth: PaperCraneAuth | undefined,
    req: http.IncomingMessage,
): boolean {
    const header = req.headers.authorization;
    if (!header || !/^Bearer\s+/i.test(header)) return false;
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token) return false;
    return isMainToken(auth, token);
}

/** The main token a request carries, Bearer or as a Basic password; null when it carries none or a session's */
export function mainTokenOf(auth: PaperCraneAuth | undefined, sessions: DavSessionStore, req: http.IncomingMessage): string | null {
    const header = req.headers.authorization ?? "";
    const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : parseBasic(header)?.pass ?? "";
    return sessions.isSessionSecret(token) || !isMainToken(auth, token) ? null : token;
}
