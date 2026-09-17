import * as fs from "fs";
import * as path from "path";
import { writeFileAtomicSync, sanitizeId } from "./storage";
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
        try {
            if (fs.existsSync(this.file)) {
                const parsed: SecretFile = JSON.parse(fs.readFileSync(this.file, "utf-8"));
                if (parsed && typeof parsed === "object") {
                    for (const [key, entry] of Object.entries(parsed as Record<string, SecretEntry>)) {
                        if (typeof entry?.value === "string") {
                            this.secrets.set(key, { ...entry, setAt: entry.setAt ?? new Date().toISOString() });
                        } else {
                            logger.debug(`[Credentials] skipping malformed entry ${key}`);
                        }
                    }
                }
            }
        } catch (err) {
            // quarantine before starting empty: never overwrite data we
            // could not read — the bytes might be worth partial recovery
            const quarry = `${this.file}.corrupt-${Date.now()}`;
            try {
                fs.renameSync(this.file, quarry);
                logger.error(
                    `[Credentials] secrets store unreadable, quarantined to ${quarry}:`,
                    err,
                );
            } catch (moveErr) {
                logger.error("[Credentials] secrets store unreadable AND quarantine failed:", moveErr);
                throw moveErr;
            }
            this.secrets = new Map();
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

    // names only, never values; defaults to the calling panel's keys
    public list(panelId?: string, includeOtherPanels = false): string[] {
        const panel = panelId !== undefined ? this.validatePanelId(panelId) : null;
        const keys: string[] = [];
        for (const key of this.secrets.keys()) {
            if (!includeOtherPanels && key.split("/")[0] !== panel) continue;
            keys.push(key);
        }
        return keys.sort();
    }

    public purge(panelId: string): number {
        const panel = this.validatePanelId(panelId);
        // Recovery material stays in the restricted vault directory and is
        // staged successfully before the live store is changed.
        const entries = [...this.secrets].filter(([key]) => key.split("/")[0] === panel);
        if (entries.length) {
            const recoveryDir = path.join(path.dirname(this.file), "vault-recovery");
            fs.mkdirSync(recoveryDir, { recursive: true, mode: 0o700 });
            if (fs.readdirSync(recoveryDir).length >= 64) throw new Error("Vault recovery storage is full; archive recovery files before purging");
            writeFileAtomicSync(path.join(recoveryDir, `${panel}-${Date.now()}.json`), JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
        }
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

    public restoreRecovery(fileName: string, panelId: string): void {
        const panel = this.validatePanelId(panelId);
        if (!fileName.startsWith(`${panel}-`) || path.basename(fileName) !== fileName || !fileName.endsWith(".json")) {
            throw new SecretError("INVALID_PARAMS", "Invalid vault recovery record");
        }
        const file = path.join(path.dirname(this.file), "vault-recovery", fileName);
        const recovered = JSON.parse(fs.readFileSync(file, "utf8")) as SecretFile;
        for (const [key, value] of Object.entries(recovered)) {
            if (!key.startsWith(`${panel}/`) || typeof value?.value !== "string") throw new Error("Invalid vault recovery contents");
            if (this.secrets.has(key)) throw new Error("Restore refused: a live secret would be overwritten");
        }
        const previous = new Map(this.secrets);
        try {
            for (const [key, value] of Object.entries(recovered)) this.secrets.set(key, value);
            this.save();
        } catch (err) { this.secrets = previous; throw err; }
    }
}
