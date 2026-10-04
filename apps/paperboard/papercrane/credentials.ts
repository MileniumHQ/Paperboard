import * as fs from "fs";
import * as path from "path";
import { readStateFileSync, writeFileAtomicSync, sanitizeId } from "./storage";
import { logger } from "./logger";

export const SECRET_MAX_LENGTH = 8192;

// per-panel entry cap; set() refuses loudly instead of silently failing
// (matches the token-vault-full pattern)
export const SECRETS_PER_PANEL_CAP = 64;

const NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

// typed vault errors: the RPC layer maps err.code to the wire instead of
// regex-matching message text (one reworded message would break that map)
export type SecretErrorCode = "INVALID_PARAMS" | "FORBIDDEN";

export class SecretError extends Error {
    readonly code: SecretErrorCode;
    constructor(code: SecretErrorCode, message: string) {
        super(message);
        this.name = "SecretError";
        this.code = code;
    }
}

interface SecretEntry {
    value: string;
    setAt: string;
    updatedAt?: string;
}

type SecretFile = Record<string, SecretEntry>;

function secretKey(panelId: string, name: string): string {
    return `${panelId}/${name}`;
}

// daemon-owned secret vault: values only leave via secrets:get, never
// config reads, file reads, or WebDAV (dav.ts refuses the store file)
export class CredentialStore {
    private file: string;
    private secrets = new Map<string, SecretEntry>();

    constructor(appDataDir: string) {
        this.file = path.join(appDataDir, "local", "secrets.json");
        this.load();
    }

    private load(): void {
        // unparseable stores are quarantined by the shared state reader,
        // never overwritten (storage.readStateFileSync)
        const parsed = readStateFileSync<SecretFile | null>(this.file, null, "secrets store");
        if (!parsed || typeof parsed !== "object") return;
        for (const [key, entry] of Object.entries(parsed as Record<string, SecretEntry>)) {
            if (typeof entry?.value === "string") {
                this.secrets.set(key, { ...entry, setAt: entry.setAt ?? new Date().toISOString() });
            } else {
                logger.debug(`[Credentials] skipping malformed entry ${key}`);
            }
        }
    }

    private save(): void {
        const data: SecretFile = Object.fromEntries(this.secrets);
        writeFileAtomicSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 });
        try {
            fs.chmodSync(this.file, 0o600);
        } catch (err) {
            logger.warn("[Credentials] chmod 0600 on secrets store failed:", err);
        }
    }

    private validatePanelId(panelId: string): string {
        const clean = sanitizeId(panelId);
        if (!clean) throw new SecretError("INVALID_PARAMS", `Invalid panel id: ${JSON.stringify(panelId)}`);
        return clean;
    }

    public set(name: string, value: string, panelId: string): void {
        const panel = this.validatePanelId(panelId);
        if (typeof name !== "string" || !NAME_RE.test(name)) {
            throw new SecretError("INVALID_PARAMS", `Invalid secret name: ${JSON.stringify(name)}`);
        }
        if (typeof value !== "string" || value.length === 0) {
            throw new SecretError("INVALID_PARAMS", "Secret value must be a non-empty string");
        }
        if (value.length > SECRET_MAX_LENGTH) {
            throw new SecretError("INVALID_PARAMS", `Secret exceeds ${SECRET_MAX_LENGTH} character limit`);
        }
        const prev = this.hasEntry(panel, name);
        if (!prev && this.countForPanel(panel) >= SECRETS_PER_PANEL_CAP) {
            throw new SecretError(
                "INVALID_PARAMS",
                `Secret vault full for ${panel} (${SECRETS_PER_PANEL_CAP} entries). Delete one before adding another.`,
            );
        }
        const key = secretKey(panel, name);
        const previous = this.secrets.get(key);
        const now = new Date().toISOString();
        this.secrets.set(key, {
            value,
            setAt: this.secrets.get(key)?.setAt ?? now,
            updatedAt: prev ? now : undefined,
        });
        try { this.save(); }
        catch (err) {
            if (previous) this.secrets.set(key, previous);
            else this.secrets.delete(key);
            throw err;
        }
    }

    private hasEntry(panel: string, name: string): boolean {
        return this.secrets.has(secretKey(panel, name));
    }

    private countForPanel(panel: string): number {
        let n = 0;
        for (const key of this.secrets.keys()) {
            if (key.split("/")[0] === panel) n++;
        }
        return n;
    }

    public get(name: string, panelId: string): { found: boolean; value: string | null } {
        const panel = this.validatePanelId(panelId);
        if (typeof name !== "string" || !NAME_RE.test(name)) {
            return { found: false, value: null };
        }
        const entry = this.secrets.get(secretKey(panel, name));
        return entry ? { found: true, value: entry.value } : { found: false, value: null };
    }

    public delete(name: string, panelId: string): boolean {
        const panel = this.validatePanelId(panelId);
        if (typeof name !== "string" || !NAME_RE.test(name)) return false;
        const existed = this.secrets.delete(secretKey(panel, name));
        if (existed) this.save();
        return existed;
    }

    // names only, never values, and only one panel's keys: the wire (and
    // every caller) resolves identity explicitly, no cross-panel widening
    public list(panelId?: string): string[] {
        const panel = panelId !== undefined ? this.validatePanelId(panelId) : null;
        const keys: string[] = [];
        for (const key of this.secrets.keys()) {
            if (panel !== null && key.split("/")[0] !== panel) continue;
            keys.push(key);
        }
        return keys.sort();
    }

    public purge(panelId: string): number {
        const panel = this.validatePanelId(panelId);
        // A purge deletes: no recovery copy is staged, so a failed save
        // rolls the in-memory store back and leaves the live file alone.
        const entries = [...this.secrets].filter(([key]) => key.split("/")[0] === panel);
        let purged = 0;
        for (const key of this.secrets.keys()) {
            if (key.split("/")[0] === panel) {
                this.secrets.delete(key);
                purged++;
            }
        }
        if (purged > 0) {
            try { this.save(); }
            catch (err) { for (const [key, entry] of entries) this.secrets.set(key, entry); throw err; }
        }
        return purged;
    }
}
