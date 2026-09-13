import * as path from "path";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import {
    readJsonFileSync,
    writeFileAtomicSync,
} from "./storage";
import { getLocalDir } from "./paths";
import { secretsMatch } from "./secretCompare";

export interface AuthorizedToken {
    token: string;
    clientName?: string;
    pairedAt: string;
    lastSeenAt?: string;
    // panel scope claim: identity is granted at issuance, never parsed from
    // a URL or trusted from a caller parameter. Absent = full-authority
    // master/host token (pre-scoped-token flows).
    panelId?: string;
}

const BASE_LOCKOUT_MS = 5_000;
const ESCALATED_LOCKOUT_MS = 30_000;
const LOCKOUT_ESCALATION_THRESHOLD = 3;

// token vault cap: refusals for NEW pairing only, never automatic eviction
// of already-trusted credentials
const MAX_TOKENS = 200;

// pairing auth and token store
export class PaperCraneAuth extends EventEmitter {
    private tokensFile: string;
    private pairingCode: string | null = null;
    private pairingActive: boolean = false;
    private lockedUntil: number = 0;
    private failedAttempts: number = 0;
    private authorizedTokens: Map<string, AuthorizedToken> = new Map();
    // per-token lookup index keyed by the token's SHA-256 digest. Lookup
    // is O(1) without leaking per-token timing (the digest of the PRESENTED
    // token is the only per-request work); the compare itself stays
    // constant-time (one secretsMatch against the found entry). Rebuilt
    // whenever the vault mutates; teardown = map replaced, no timers.
    private tokenIndex: Map<string, AuthorizedToken> = new Map();
    public noAuth: boolean = false;

    // injectable clock for testable lockouts
    private now: () => number;

    private tokensDirty = false;
    private lastSeenFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly lastSeenFlushMs = 60_000;

    constructor(noAuth = false, dataDir?: string, now?: () => number) {
        super();
        this.noAuth = noAuth;
        this.tokensFile = path.join(dataDir || getLocalDir(), "authorized_tokens.json");

        this.now = now || (() => Date.now());
        this.loadTokens();
    }

    private tokenHash(token: string): string {
        // sha256 of the raw token bytes; the digest exists only in memory
        // beside the tokens themselves (same trust domain)
        return crypto.createHash("sha256").update(token, "utf8").digest("hex");
    }

    private rebuildIndex(): void {
        const index = new Map<string, AuthorizedToken>();
        for (const entry of this.authorizedTokens.values()) {
            index.set(this.tokenHash(entry.token), entry);
        }
        this.tokenIndex = index;
    }

    // identity index lookup: hash the presented token, one Map probe, then
    // exactly ONE constant-time secretsMatch against the found entry.
    // Behaviorally identical to the old linear scan (same entries, same
    // results) — the per-request work no longer scales with vault size.
    public matchToken(token?: string): AuthorizedToken | null {
        if (!token) return null;
        const entry = this.tokenIndex.get(this.tokenHash(token));
        if (entry && secretsMatch(entry.token, token)) {
            return entry;
        }
        return null;
    }

    // random 6-digit code via crypto
    private generatePairingCode(): string {
        return crypto.randomInt(100000, 1000000).toString();
    }

    // registers a known token programmatically for the local host.
    // panelId grants a scope claim at issuance: the vault and per-panel
    // resources derive the caller's panel from this claim, not from a
    // caller-supplied parameter.
    public injectToken(token: string, clientName = "local", panelId?: string): void {
        if (this.authorizedTokens.has(token)) return;
        const entry: AuthorizedToken = {
            token,
            clientName,
            pairedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            ...(panelId ? { panelId } : {}),
        };
        this.authorizedTokens.set(token, entry);
        this.saveTokens();
    }

    // mints (or reuses) the panel-scoped token for one panel id. One live
    // token per panel id — bounded by the panel count, never by the pairing
    // budget, so a thousand panels cannot evict user pairings.
    public issuePanelToken(panelId: string): string {
        for (const entry of this.authorizedTokens.values()) {
            if (entry.panelId === panelId) return entry.token;
        }
        const token = "pcp_" + crypto.randomBytes(24).toString("hex");
        const entry: AuthorizedToken = {
            token,
            clientName: `panel-service:${panelId}`,
            pairedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            panelId,
        };
        this.authorizedTokens.set(token, entry);
        this.saveTokens();
        return token;
    }

    public startPairing(): string {
        this.pairingCode = this.generatePairingCode();
        this.pairingActive = true;
        // restarting pairing never resets the brute-force lockout
        this.emit("pairingStarted", this.pairingCode);
        return this.pairingCode;
    }

    public cancelPairing(): void {
        this.pairingActive = false;
        this.pairingCode = null;
        this.emit("pairingCancelled");
    }

    public isPairingActive(): boolean {
        return this.pairingActive;
    }

    public getPairingCode(): string | null {
        return this.pairingCode;
    }

    public getAuthorizedClients(): AuthorizedToken[] {
        return Array.from(this.authorizedTokens.values());
    }

    private loadTokens() {
        const list = readJsonFileSync<AuthorizedToken[]>(this.tokensFile, []);
        if (Array.isArray(list)) {
            for (const item of list) {
                if (item?.token) this.authorizedTokens.set(item.token, item);
            }
        }
        this.rebuildIndex();
    }

    private saveTokens() {
        this.tokensDirty = false;
        if (this.lastSeenFlushTimer) {
            clearTimeout(this.lastSeenFlushTimer);
            this.lastSeenFlushTimer = null;
        }
        try {
            // no eviction: every stored token is live user trust. Bounded by
            // refusing NEW pairing past MAX_TOKENS (see pair/injectToken)
            const list = Array.from(this.authorizedTokens.values());
            writeFileAtomicSync(this.tokensFile, JSON.stringify(list, null, 2), {
                mode: 0o600,
            });
        } catch (err) {
            console.error("[auth] token store write failed:", err);
        }
        // keep the hash index in lockstep with the vault
        this.rebuildIndex();
    }

    // lastSeenAt is commit-marked, not write-through: verifying a token in
    // memory sets the dirty flag and schedules one throttled flush, so a hot
    // verify loop never hammers the vault file
    private markTokensDirty(): void {
        this.tokensDirty = true;
        if (this.lastSeenFlushTimer) return;
        this.lastSeenFlushTimer = setTimeout(() => {
            this.lastSeenFlushTimer = null;
            this.flushTokenStore();
        }, this.lastSeenFlushMs);
        (this.lastSeenFlushTimer as unknown as { unref?: () => void })?.unref?.();
    }

    public get isTokensDirty(): boolean {
        return this.tokensDirty;
    }

    // flush now instead of waiting on the throttled timer (also cancels it)
    public flushTokenStore(): void {
        if (this.lastSeenFlushTimer) {
            clearTimeout(this.lastSeenFlushTimer);
            this.lastSeenFlushTimer = null;
        }
        if (this.tokensDirty) {
            this.tokensDirty = false;
            this.saveTokens();
        }
    }

    public dispose(): void {
        if (this.lastSeenFlushTimer) {
            clearTimeout(this.lastSeenFlushTimer);
            this.lastSeenFlushTimer = null;
        }
        if (this.tokensDirty) this.saveTokens();
    }

    public isLocked(): { locked: boolean; remainingSeconds: number } {
        const now = this.now();
        if (now < this.lockedUntil) {
            const remainingSeconds = Math.ceil((this.lockedUntil - now) / 1000);
            return { locked: true, remainingSeconds };
        }
        return { locked: false, remainingSeconds: 0 };
    }

    public pair(
        code: string,
        clientName?: string,
    ): {
        success: boolean;
        token?: string;
        error?: string;
        remainingSeconds?: number;
    } {
        if (this.noAuth) {
            return { success: true, token: "pc_local" };
        }

        if (!this.pairingActive || !this.pairingCode) {
            return {
                success: false,
                error: "Pairing is not currently active on this computer.",
            };
        }

        const lockStatus = this.isLocked();
        if (lockStatus.locked) {
            return {
                success: false,
                error: `Pairing locked. Please wait ${lockStatus.remainingSeconds}s before retrying.`,
                remainingSeconds: lockStatus.remainingSeconds,
            };
        }

        const cleanInput = String(code ?? "").replace(/\s+/g, "").trim();
        if (cleanInput !== this.pairingCode) {
            this.failedAttempts++;
            // short penalty first, long on clear brute-forcing
            const lockoutMs =
                this.failedAttempts >= LOCKOUT_ESCALATION_THRESHOLD
                    ? ESCALATED_LOCKOUT_MS
                    : BASE_LOCKOUT_MS;
            this.lockedUntil = this.now() + lockoutMs;
            return {
                success: false,
                error: `Invalid pairing code. Pairing is locked for ${Math.round(lockoutMs / 1000)} seconds.`,
                remainingSeconds: Math.round(lockoutMs / 1000),
            };
        }

        this.failedAttempts = 0;

        if (this.authorizedTokens.size >= MAX_TOKENS) {
            return {
                success: false,
                error: `Token vault is full (${MAX_TOKENS} paired clients). Revoke a device before pairing another.`,
            };
        }

        const token = "pc_" + crypto.randomBytes(24).toString("hex");
        const entry: AuthorizedToken = {
            token,
            clientName: clientName || "Paperboard Client",
            pairedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
        };

        this.authorizedTokens.set(token, entry);
        this.saveTokens();

        this.pairingActive = false;
        this.pairingCode = null;
        this.emit("paired", entry);

        return { success: true, token };
    }

    public verifyToken(token?: string): boolean {
        if (this.noAuth) return true;
        return this.resolveToken(token) !== null;
    }

    // identity lookup: returns the stored entry (claims included) instead
    // of a bare boolean, so RPC handlers derive the caller's panel from
    // the credential instead of trusting a parameter. noAuth mode returns
    // null = unconstrained caller (local dev only, never panel equipment).
    public resolveToken(token?: string): AuthorizedToken | null {
        if (this.noAuth) return null;
        const entry = this.matchToken(token);
        if (entry) {
            entry.lastSeenAt = new Date().toISOString();
            this.markTokensDirty();
            return entry;
        }
        return null;
    }

    public revokeToken(token: string): boolean {
        const entry = this.authorizedTokens.get(token);
        const deleted = this.authorizedTokens.delete(token);
        if (deleted) {
            this.saveTokens();
            if (entry) this.emit("revoked", entry);
        }
        return deleted;
    }

    // revokes every token carrying the panel's scope claim. Called on panel
    // uninstall: a removed panel's credential must stop authenticating the
    // moment the panel is gone, not linger in the vault.
    public revokePanelTokens(panelId: string): number {
        let revoked = 0;
        for (const [token, entry] of this.authorizedTokens.entries()) {
            if (entry.panelId === panelId) {
                this.authorizedTokens.delete(token);
                revoked++;
            }
        }
        if (revoked > 0) {
            this.saveTokens();
            this.emit("panel-revoked", panelId, revoked);
        }
        return revoked;
    }
}
