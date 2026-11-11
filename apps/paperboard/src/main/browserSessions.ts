// Who may use Paperboard in the browser (browserHost.ts). Paperboard itself
// hands out the way in: "Open in Browser" and `--web` open a sign-in link
// that works once, for a few minutes. Following it gives that browser a
// session, kept in an HttpOnly cookie, so reloads, bookmarks and restarts
// of Paperboard keep working until it expires or the browser signs out.
//
// Sessions are kept only as SHA-256 hashes, in an owner-only file, so the
// file is no use to anyone who reads it. Sign-in links live in memory
// only: a restart throws away the ones nobody followed.
import * as crypto from "crypto";
import * as path from "path";
import { readStateFileSync, writeJsonAtomicSync } from "../../papercrane/storage";
import { ensurePrivateDir } from "../../papercrane/paths";

export const SIGN_IN_LINK_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
// bounds: links nobody followed yet, browsers signed in at once
export const MAX_SIGN_IN_LINKS = 16;
export const MAX_SESSIONS = 32;

interface StoredSession {
    hash: string;
    expiresAt: number;
}

interface SessionFile {
    v: 1;
    sessions: StoredSession[];
}

export interface SignedIn {
    token: string;
    expiresAt: number;
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("base64url");
const newToken = () => crypto.randomBytes(32).toString("base64url");
// every token this module makes is 43 base64url characters
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export class BrowserSessions {
    // sign-in link hash -> expiry
    private links = new Map<string, number>();
    private sessions: StoredSession[];

    constructor(
        private readonly file: string,
        private readonly now: () => number = Date.now,
    ) {
        const stored = readStateFileSync<SessionFile>(file, { v: 1, sessions: [] }, "browser sessions");
        const list = Array.isArray(stored?.sessions) ? stored.sessions : [];
        this.sessions = list.filter(
            (s) => typeof s?.hash === "string" && typeof s?.expiresAt === "number" && s.expiresAt > this.now(),
        );
    }

    /** a link token that signs one browser in, once, within SIGN_IN_LINK_TTL_MS */
    issueSignInLink(): string {
        const now = this.now();
        for (const [key, expiresAt] of this.links) if (expiresAt <= now) this.links.delete(key);
        // the oldest unfollowed link makes room
        while (this.links.size >= MAX_SIGN_IN_LINKS) this.links.delete(this.links.keys().next().value!);
        const token = newToken();
        this.links.set(hash(token), now + SIGN_IN_LINK_TTL_MS);
        return token;
    }

    /** spends a sign-in link on a new session; null when it's unknown, used or expired */
    redeemSignInLink(link: unknown): SignedIn | null {
        if (typeof link !== "string" || !TOKEN_SHAPE.test(link)) return null;
        const key = hash(link);
        const expiresAt = this.links.get(key);
        this.links.delete(key);
        if (expiresAt === undefined || expiresAt <= this.now()) return null;
        const token = newToken();
        const session = { hash: hash(token), expiresAt: this.now() + SESSION_TTL_MS };
        this.sessions = this.live();
        // the oldest browser is signed out to make room
        this.sessions.sort((a, b) => a.expiresAt - b.expiresAt);
        while (this.sessions.length >= MAX_SESSIONS) this.sessions.shift();
        this.sessions.push(session);
        this.save();
        return { token, expiresAt: session.expiresAt };
    }

    isSignedIn(token: unknown): boolean {
        if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return false;
        const key = hash(token);
        return this.live().some((s) => s.hash === key);
    }

    signOut(token: unknown): void {
        if (typeof token !== "string") return;
        const key = hash(token);
        const before = this.sessions.length;
        this.sessions = this.sessions.filter((s) => s.hash !== key);
        if (this.sessions.length !== before) this.save();
    }

    private live(): StoredSession[] {
        const now = this.now();
        return this.sessions.filter((s) => s.expiresAt > now);
    }

    private save(): void {
        ensurePrivateDir(path.dirname(this.file));
        writeJsonAtomicSync(this.file, { v: 1, sessions: this.live() } satisfies SessionFile, { mode: 0o600 });
    }
}
