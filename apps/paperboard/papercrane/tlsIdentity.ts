// The daemon's TLS identity: one ECDSA P-256 key and a self-signed
// certificate, created on first start and kept for the life of the install.
// Clients pin this exact certificate when they pair (trust on first use), so
// replacing it means every paired computer has to pair again. That is why an
// unreadable identity file is a startup failure, never a reason to mint a
// new one over it.
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { writeFileAtomicSync } from "./storage";

export interface TlsIdentity {
    key: string;
    cert: string;
}

const IDENTITY_FILE = "tls_identity.json";
// Clients reach a daemon by whatever address works (LAN IP, VPS address,
// DNS name), so the certificate names one fixed server name instead and
// clients send it as the TLS servername. Trust comes from the pin, not
// from the name.
export const TLS_SERVER_NAME = "paperboard-server";
const VALIDITY_DAYS = 3650;

// minimal DER: just the shapes one self-signed certificate needs
function derLength(n: number): Buffer {
    if (n < 0x80) return Buffer.from([n]);
    const bytes: number[] = [];
    for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function tlv(tag: number, body: Buffer): Buffer {
    return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}
const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts));
function oid(dotted: string): Buffer {
    const parts = dotted.split(".").map(Number);
    const out = [40 * parts[0] + parts[1]];
    for (const value of parts.slice(2)) {
        const chunk = [value & 0x7f];
        for (let x = value >> 7; x > 0; x >>= 7) chunk.unshift((x & 0x7f) | 0x80);
        out.push(...chunk);
    }
    return tlv(0x06, Buffer.from(out));
}
function utcTime(d: Date): Buffer {
    const s = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
    return tlv(0x17, Buffer.from(`${s.slice(2, 4)}${s.slice(5, 7)}${s.slice(8, 10)}${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`));
}

export function createTlsIdentity(now = Date.now()): TlsIdentity {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
    const name = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from("Paperboard Server")))));
    const serial = crypto.randomBytes(16);
    serial[0] = (serial[0] & 0x7f) | 0x01; // positive, no leading zero
    const tbs = seq(
        tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
        tlv(0x02, serial),
        ecdsaSha256,
        name,
        seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + VALIDITY_DAYS * 86_400_000))),
        name,
        publicKey.export({ type: "spki", format: "der" }),
        // [3] extensions: subjectAltName = DNS:paperboard-server
        tlv(0xa3, seq(seq(oid("2.5.29.17"), tlv(0x04, seq(tlv(0x82, Buffer.from(TLS_SERVER_NAME))))))),
    );
    const signature = crypto.sign("sha256", tbs, privateKey);
    const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
    const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
    return { key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, cert };
}

function parseIdentity(raw: string, file: string): TlsIdentity {
    const parsed = JSON.parse(raw) as Partial<TlsIdentity>;
    if (typeof parsed?.key !== "string" || typeof parsed?.cert !== "string") {
        throw new Error(`TLS identity ${file} is missing its key or certificate`);
    }
    const cert = new crypto.X509Certificate(parsed.cert);
    if (!cert.checkPrivateKey(crypto.createPrivateKey(parsed.key))) {
        throw new Error(`TLS identity ${file} has a key that does not match its certificate`);
    }
    return { key: parsed.key, cert: parsed.cert };
}

export function loadOrCreateTlsIdentity(dir: string): TlsIdentity {
    const file = path.join(dir, IDENTITY_FILE);
    let raw: string | null = null;
    try {
        raw = fs.readFileSync(file, "utf8");
    } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
    }
    if (raw !== null) {
        try {
            return parseIdentity(raw, file);
        } catch (err: any) {
            throw new Error(
                `${err?.message ?? err}. Paired computers trust this identity; move ${file} aside only if you intend to pair every computer again.`,
            );
        }
    }
    // link() refuses an existing target: if another daemon process created
    // the identity first, both end up serving the winner's certificate
    const identity = createTlsIdentity();
    const staged = `${file}.new-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    writeFileAtomicSync(staged, JSON.stringify(identity), { mode: 0o600 });
    try {
        fs.linkSync(staged, file);
        return identity;
    } catch (err: any) {
        if (err?.code !== "EEXIST") throw err;
        return parseIdentity(fs.readFileSync(file, "utf8"), file);
    } finally {
        fs.unlinkSync(staged);
    }
}
