// The daemon's TLS identity (bun test). Paired computers pin it, so it is
// created once, reused, owner-only, and an unreadable identity is a refusal:
// silently minting a new one would orphan every pairing.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createTlsIdentity, loadOrCreateTlsIdentity, TLS_SERVER_NAME } from "../papercrane/tlsIdentity";

let dir = "";
const file = () => path.join(dir, "tls_identity.json");

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-tls-identity-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("TLS identity", () => {
    it("creates a self-signed P-256 certificate naming the fixed server name", () => {
        const { key, cert } = loadOrCreateTlsIdentity(dir);
        const x509 = new crypto.X509Certificate(cert);
        expect(x509.checkPrivateKey(crypto.createPrivateKey(key))).toBe(true);
        expect(x509.verify(x509.publicKey)).toBe(true);
        expect(x509.subjectAltName).toBe(`DNS:${TLS_SERVER_NAME}`);
        expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(dir)).toEqual(["tls_identity.json"]);
    });

    it("reuses the stored identity", () => {
        const first = loadOrCreateTlsIdentity(dir);
        expect(loadOrCreateTlsIdentity(dir)).toEqual(first);
    });

    it("refuses an unreadable identity and leaves it in place", () => {
        fs.writeFileSync(file(), "{not json");
        expect(() => loadOrCreateTlsIdentity(dir)).toThrow(/pair every computer again/);
        expect(fs.readFileSync(file(), "utf8")).toBe("{not json");
    });

    it("refuses a key that does not match the certificate", () => {
        const a = createTlsIdentity();
        const b = createTlsIdentity();
        fs.writeFileSync(file(), JSON.stringify({ key: b.key, cert: a.cert }));
        expect(() => loadOrCreateTlsIdentity(dir)).toThrow(/does not match/);
    });
});
