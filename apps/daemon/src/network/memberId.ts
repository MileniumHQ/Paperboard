// How a computer is named everywhere in the network: its member id, the
// first 160 bits of SHA-256 over its daemon's TLS public key (the
// SubjectPublicKeyInfo DER), as 40 lowercase hex characters. It names the
// key, not the certificate, so a certificate reissued for the same key is
// the same computer. The roster lists members by it and every record names
// its author by it (record.ts).
import * as crypto from "crypto";

// 160 bits: one DNS label (a panel's panel://<computer>.<panel> origin), and far past any collision
const MEMBER_ID_LENGTH = 40;
const MEMBER_ID_RE = /^[0-9a-f]{40}$/;

/** The member id of the computer whose daemon holds the key in this certificate (PEM). */
export function memberIdOf(certPem: string): string {
    const key = new crypto.X509Certificate(certPem).publicKey.export({ type: "spki", format: "der" });
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, MEMBER_ID_LENGTH);
}

export function isMemberId(value: unknown): value is string {
    return typeof value === "string" && MEMBER_ID_RE.test(value);
}
