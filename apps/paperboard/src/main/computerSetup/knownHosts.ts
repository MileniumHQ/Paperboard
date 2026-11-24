// The person's OpenSSH `known_hosts`, read and written as `ssh` does:
// comma-separated host patterns (wildcards, `!negation`), hashed names
// (`|1|salt|hash`, HMAC-SHA1), `[host]:port` for any port but 22, and the
// `@revoked` and `@cert-authority` markers. Setting up a computer follows
// `StrictHostKeyChecking accept-new`: a host seen for the first time is
// added, a host whose key differs from the one written down is refused.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { hostMatches } from "./sshConfig";

export interface KnownHostsEntry {
    marker: "revoked" | "cert-authority" | undefined;
    /** the host field as written: patterns, or one hashed name */
    hosts: string;
    keyType: string;
    key: Buffer;
}

export type HostKeyCheck =
    /** a line for this host holds exactly this key */
    | { kind: "known" }
    /** no line names this host */
    | { kind: "new" }
    /** lines name this host, none with this key */
    | { kind: "changed"; knownTypes: string[] }
    /** this key is marked @revoked for this host */
    | { kind: "revoked" };

/** How known_hosts names a host: `host` on port 22, `[host]:port` elsewhere, lowercased. */
export function knownHostName(host: string, port: number): string {
    const name = host.toLowerCase();
    return port === 22 ? name : `[${name}]:${port}`;
}

/** The key type a public key blob names (its first SSH string). */
export function keyTypeOf(blob: Buffer): string {
    if (blob.length < 4) throw new Error("The host key is malformed");
    const length = blob.readUInt32BE(0);
    if (length === 0 || 4 + length > blob.length) throw new Error("The host key is malformed");
    return blob.subarray(4, 4 + length).toString("latin1");
}

/** The fingerprint OpenSSH prints for a key: `SHA256:` and unpadded base64. */
export function fingerprintOf(blob: Buffer): string {
    return `SHA256:${crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

/** Every entry line in a known_hosts text; comments, blank and malformed lines are left out, as ssh does. */
export function parseKnownHosts(text: string): KnownHostsEntry[] {
    const entries: KnownHostsEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
        const fields = line.trim().split(/\s+/);
        if (fields[0] === "" || fields[0].startsWith("#")) continue;
        let marker: KnownHostsEntry["marker"];
        if (fields[0].startsWith("@")) {
            if (fields[0] === "@revoked") marker = "revoked";
            else if (fields[0] === "@cert-authority") marker = "cert-authority";
            else continue;
            fields.shift();
        }
        if (fields.length < 3) continue;
        const [hosts, keyType, base64] = fields;
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) continue;
        const key = Buffer.from(base64, "base64");
        if (key.length < 4) continue;
        entries.push({ marker, hosts, keyType, key });
    }
    return entries;
}

/** Whether an entry's host field names this host (`knownHostName` form). */
export function entryMatches(hosts: string, name: string): boolean {
    if (hosts.startsWith("|1|")) {
        const [, , salt, hash] = hosts.split("|");
        if (!salt || !hash) return false;
        const expected = Buffer.from(hash, "base64");
        const actual = crypto.createHmac("sha1", Buffer.from(salt, "base64")).update(name).digest();
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }
    return hostMatches(name, hosts.split(","));
}

/** The entries that apply to a host. */
export function entriesFor(text: string, host: string, port: number): KnownHostsEntry[] {
    const name = knownHostName(host, port);
    return parseKnownHosts(text).filter((entry) => entryMatches(entry.hosts, name));
}

/**
 * What known_hosts says about a host presenting this key. Throws when a
 * certificate authority is set up for the host: those keys aren't supported.
 */
export function checkHostKey(text: string, host: string, port: number, key: Buffer): HostKeyCheck {
    const entries = entriesFor(text, host, port);
    if (entries.some((entry) => entry.marker === "revoked" && entry.key.equals(key))) return { kind: "revoked" };
    if (entries.some((entry) => entry.marker === "cert-authority")) {
        throw new Error(`known_hosts trusts a certificate authority for ${knownHostName(host, port)}, and Paperboard doesn't support certificate-authority host keys yet`);
    }
    const plain = entries.filter((entry) => entry.marker === undefined);
    if (plain.some((entry) => entry.key.equals(key))) return { kind: "known" };
    if (plain.length === 0) return { kind: "new" };
    return { kind: "changed", knownTypes: [...new Set(plain.map((entry) => entry.keyType))] };
}

/** The key types written down for a host, so the connection can ask for one of those first. */
export function knownKeyTypes(text: string, host: string, port: number): string[] {
    const types = entriesFor(text, host, port).filter((entry) => entry.marker === undefined).map((entry) => entry.keyType);
    return [...new Set(types)];
}

/** Reads known_hosts, or "" when there isn't one yet. */
export function readKnownHosts(file: string): string {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Adds `host keytype base64` for a host, creating the file (0600) and its folder (0700) when missing. */
export function appendKnownHost(file: string, host: string, port: number, key: Buffer): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const existing = readKnownHosts(file);
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(file, `${separator}${knownHostName(host, port)} ${keyTypeOf(key)} ${key.toString("base64")}\n`, { mode: 0o600 });
}
