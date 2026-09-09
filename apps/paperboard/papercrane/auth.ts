import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { EventEmitter } from "events";
import {
    readJsonFileSync,
    writeFileAtomicSync,
} from "./storage";
import { getLocalDir } from "./paths";

export interface AuthorizedToken {
    token: string;
    clientName?: string;
    pairedAt: string;
    lastSeenAt?: string;
}

const BASE_LOCKOUT_MS = 5_000;
const ESCALATED_LOCKOUT_MS = 30_000;
const LOCKOUT_ESCALATION_THRESHOLD = 3;

// pairing auth and token store
export class PaperCraneAuth extends EventEmitter {
    private tokensFile: string;
    private pairingCode: string | null = null;
    private pairingActive: boolean = false;
    private lockedUntil: number = 0;
    private failedAttempts: number = 0;
    private authorizedTokens: Map<string, AuthorizedToken> = new Map();
    public noAuth: boolean = false;

    // injectable clock for testable lockouts
    private now: () => number;

    constructor(noAuth = false, dataDir?: string, now?: () => number) {
        super();
        this.noAuth = noAuth;
        this.tokensFile = path.join(dataDir || getLocalDir(), "authorized_tokens.json");

        this.now = now || (() => Date.now());
        this.loadTokens();
    }

    // random 6-digit code via crypto
    private generatePairingCode(): string {
        return crypto.randomInt(100000, 1000000).toString();
    }

    // registers a known token programmatically for the local host
    public injectToken(token: string, clientName = "local"): void {
        if (this.authorizedTokens.has(token)) return;
        const entry: AuthorizedToken = {
            token,
            clientName,
            pairedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
        };
        this.authorizedTokens.set(token, entry);
        this.saveTokens();
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
    }

    private saveTokens() {
        try {
            // keep the file bounded to the newest entries
            const list = Array.from(this.authorizedTokens.values())
                .sort((a, b) => (b.pairedAt || "").localeCompare(a.pairedAt || ""))
                .slice(0, 25);
            writeFileAtomicSync(this.tokensFile, JSON.stringify(list, null, 2));
            // best-effort owner-only perms where supported
            try {
                fs.chmodSync(this.tokensFile, 0o600);
            } catch {}
        } catch {}
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
        if (!token) return false;
        const entry = this.authorizedTokens.get(token);
        if (entry) {
            entry.lastSeenAt = new Date().toISOString();
            return true;
        }
        return false;
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
}
