import * as fs from "fs";
import * as path from "path";
import { readStateFileSync, writeFileAtomicSync, sanitizeId } from "../core/storage";
import { logger } from "../core/logger";

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
        const parsed = readStateFileSync<unknown>(this.file, null, "secrets store");
        if (parsed === null) return;
        const isStore = typeof parsed === "object" && !Array.isArray(parsed);
        const entries = isStore ? Object.entries(parsed as Record<string, Partial<SecretEntry>>) : [];
        const malformed: string[] = [];
        for (const [key, entry] of entries) {
            if (typeof entry?.value === "string") this.secrets.set(key, { ...entry, value: entry.value, setAt: entry.setAt ?? new Date().toISOString() });
            else malformed.push(key);
        }
        if (isStore && malformed.length === 0) return;
        // the next save rewrites the store from what was readable: a copy of
        // the file as it was keeps what that would drop
        const kept = `${this.file}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.file, kept);
        const what = malformed.length > 0 ? `entries ${malformed.join(", ")} have no readable value` : "it is not an object of entries";
        logger.error(`[Credentials] the secrets store is damaged (${what}); its bytes are kept in ${kept}`);
    }

    private save(): void {
        // writeFileAtomicSync gives the temp file 0600 before it becomes the store
        writeFileAtomicSync(this.file, JSON.stringify(Object.fromEntries(this.secrets), null, 2), { mode: 0o600 });
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

    public get(name: unknown, panelId: string): { found: boolean; value: string | null } {
        const panel = this.validatePanelId(panelId);
        if (typeof name !== "string" || !NAME_RE.test(name)) {
            return { found: false, value: null };
        }
        const entry = this.secrets.get(secretKey(panel, name));
        return entry ? { found: true, value: entry.value } : { found: false, value: null };
    }

    public delete(name: unknown, panelId: string): boolean {
        const panel = this.validatePanelId(panelId);
        if (typeof name !== "string" || !NAME_RE.test(name)) return false;
        const key = secretKey(panel, name);
        const previous = this.secrets.get(key);
        if (!previous) return false;
        // a failed save keeps the secret: memory and the file agree
        this.secrets.delete(key);
        try { this.save(); }
        catch (err) { this.secrets.set(key, previous); throw err; }
        return true;
    }

    // names only, never values, and only one panel's names: the wire (and
    // every caller) resolves identity explicitly, no cross-panel widening.
    // The names are the ones the panel set, without the vault's panel prefix
    public list(panelId: string): string[] {
        const panel = this.validatePanelId(panelId);
        const prefix = secretKey(panel, "");
        const names: string[] = [];
        for (const key of this.secrets.keys()) {
            if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
        }
        return names.sort();
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
