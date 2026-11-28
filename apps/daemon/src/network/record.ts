// A record: the one unit everything synced between computers travels as.
// This file is its format, and the format is a contract with code that is
// not Paperboard's (a store-and-forward relay) and with future clients, so
// it is written down here exactly. Change it only with a new version tag.
//
// ─── Fields ──────────────────────────────────────────────────────────────────
//
//   space    namespace, 1-64 of [A-Za-z0-9._:@-]; "@" opens the spaces the
//            store itself owns ("@keys")
//   id       the record within its space, 1-512 bytes of well-formed UTF-8
//   wall     hybrid logical clock, milliseconds since the Unix epoch,
//            0 ≤ wall ≤ 2^53 - 1
//   counter  hybrid logical clock, the tie counter, 0 ≤ counter ≤ 2^32 - 1
//   author   the authoring computer: the SHA-256 fingerprint of its TLS
//            certificate's DER, as 32 uppercase hex pairs joined by ":"
//            (Node's X509Certificate.fingerprint256)
//   deleted  true for a delete; a delete has an empty body
//   epoch    the network key's generation the body is written under,
//            0 ≤ epoch ≤ 2^32 - 1
//   key      which key of that epoch: 16 lowercase hex characters, the first
//            8 bytes of SHA-256("paperboard-network-key-id" ‖ key). Two
//            computers can start the same epoch apart; the key id tells
//            their keys apart. Empty in "@keys" records.
//   body     ciphertext (below), at most 1 MiB
//   sig      the author's signature over the signed bytes (below)
//
// On the wire (and on disk) a record is one JSON object:
//   {"v":1,"space":…,"id":…,"wall":…,"counter":…,"author":…,
//    "deleted":…,"epoch":…,"key":…,"body":"<base64>","sig":"<base64>"}
// Everything but body is readable to anyone who carries the record, so a
// relay can index and order it; only member computers can read the body.
//
// ─── Signed bytes ────────────────────────────────────────────────────────────
//
//   header = "PBR1"                         4 ASCII bytes, the format version
//            str(space) str(id)
//            u64(wall) u32(counter)
//            str(author)
//            u8(deleted ? 1 : 0)
//            u32(epoch)
//            str(key)
//   signed = header ‖ u32(byte length of body) ‖ body
//
//   str(s) = u16(byte length of UTF-8 s) ‖ UTF-8 s
//   u8/u16/u32/u64 = unsigned big-endian integers of 1/2/4/8 bytes
//
//   sig = ECDSA P-256 with SHA-256 over `signed`, in IEEE P1363 form (r ‖ s,
//   64 bytes): what WebCrypto produces. The key is the author's TLS key.
//
//   A record's identity is SHA-256(signed): its digest. Two copies with the
//   same digest are the same record, whatever their signature bytes (ECDSA
//   signatures are malleable).
//
// ─── Body ────────────────────────────────────────────────────────────────────
//
//   A delete's body is empty. Any other record in a space of its own has
//     body = nonce(12) ‖ AES-256-GCM(network key, nonce, aad = header,
//                                   UTF-8 JSON of the value) ‖ tag(16)
//   using the key `key` names. A "@keys" record carries network keys to
//   one computer (wrapKeys below); its epoch is the newest epoch it
//   carries, and a key for a later epoch than that in it is not used.
//
// ─── Order ───────────────────────────────────────────────────────────────────
//
//   For one space and id, the record that sorts last wins: by wall, then
//   counter, then author (bytewise), then digest (bytewise). Every
//   computer sorts the same way, so every computer picks the same winner.
import * as crypto from "crypto";

export const KEYS_SPACE = "@keys";
export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ID_BYTES = 512;
const MAX_COUNTER = 0xffff_ffff;
const SPACE_RE = /^[A-Za-z0-9._:@-]{1,64}$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const KEY_ID_RE = /^[0-9a-f]{16}$/;
const MAGIC = Buffer.from("PBR1", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const NETWORK_KEY_BYTES = 32;
// a P-256 public key as SubjectPublicKeyInfo DER is always 91 bytes
const SPKI_BYTES = 91;

/** Everything about a record but its body: what a relay sees and a membership rule decides on. */
export interface RecordHeader {
    space: string;
    id: string;
    wall: number;
    counter: number;
    author: string;
    deleted: boolean;
    epoch: number;
    key: string;
}

export interface WireRecord extends RecordHeader {
    v: 1;
    /** base64 */
    body: string;
    /** base64 */
    sig: string;
}

/** One generation of the network key. */
export interface NetworkKey {
    epoch: number;
    id: string;
    key: Buffer;
}

export class RecordFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RecordFormatError";
    }
}

function fail(message: string): never {
    throw new RecordFormatError(message);
}

export function isFingerprint(value: unknown): value is string {
    return typeof value === "string" && FINGERPRINT_RE.test(value);
}

export function fingerprintOf(certPem: string): string {
    return new crypto.X509Certificate(certPem).fingerprint256;
}

/** The space a computer may write in, or a RecordFormatError saying why not. */
export function checkSpace(space: unknown): asserts space is string {
    if (typeof space !== "string" || !SPACE_RE.test(space)) fail(`Invalid record space ${JSON.stringify(space)}`);
}

export function checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0 || !id.isWellFormed() || Buffer.byteLength(id) > MAX_ID_BYTES) {
        fail(`Invalid record id ${JSON.stringify(id)}`);
    }
}

/** A "@keys" record's id: the computer it carries keys to, then the one that wrapped them. */
export function keysRecordId(recipient: string, creator: string): string {
    return `${recipient}/${creator}`;
}

function isUint(value: unknown, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Checks the shape of a record from anywhere (a peer, a relay, disk); throws RecordFormatError. */
export function parseWireRecord(value: unknown): WireRecord {
    if (!value || typeof value !== "object") fail("A record must be an object");
    const r = value as Record<string, unknown>;
    if (r.v !== 1) fail(`Unknown record version ${JSON.stringify(r.v)}`);
    checkSpace(r.space);
    checkId(r.id);
    if (!isUint(r.wall, Number.MAX_SAFE_INTEGER)) fail(`Invalid record clock ${JSON.stringify(r.wall)}`);
    if (!isUint(r.counter, MAX_COUNTER)) fail(`Invalid record counter ${JSON.stringify(r.counter)}`);
    if (!isFingerprint(r.author)) fail(`Invalid record author ${JSON.stringify(r.author)}`);
    if (typeof r.deleted !== "boolean") fail("A record's deleted flag must be true or false");
    if (!isUint(r.epoch, 0xffff_ffff)) fail(`Invalid record epoch ${JSON.stringify(r.epoch)}`);
    if (typeof r.key !== "string") fail("A record's key id must be a string");
    if (typeof r.body !== "string" || typeof r.sig !== "string") fail("A record's body and signature must be base64 strings");
    const body = decodeBase64(r.body, "body");
    if (decodeBase64(r.sig, "signature").length !== 64) fail("A record's signature must be 64 bytes");
    if (body.length > MAX_BODY_BYTES) fail(`A record's body is over ${MAX_BODY_BYTES} bytes`);

    if (r.space === KEYS_SPACE) {
        const [recipient, creator, ...rest] = (r.id as string).split("/");
        if (rest.length || !isFingerprint(recipient) || creator !== r.author) {
            fail(`A ${KEYS_SPACE} record's id must be <recipient>/<its author>`);
        }
        if (r.deleted || r.key !== "") fail(`A ${KEYS_SPACE} record can't be deleted and names no key`);
        if (body.length < SPKI_BYTES + NONCE_BYTES + TAG_BYTES) fail(`A ${KEYS_SPACE} record's body is too short`);
    } else if ((r.space as string).startsWith("@")) {
        fail(`Unknown reserved space ${JSON.stringify(r.space)}`);
    } else {
        if (!KEY_ID_RE.test(r.key)) fail(`Invalid record key id ${JSON.stringify(r.key)}`);
        if (r.deleted ? body.length !== 0 : body.length < NONCE_BYTES + TAG_BYTES) {
            fail(r.deleted ? "A delete has an empty body" : "A record's body is too short");
        }
    }
    return {
        v: 1,
        space: r.space as string,
        id: r.id as string,
        wall: r.wall,
        counter: r.counter,
        author: r.author,
        deleted: r.deleted,
        epoch: r.epoch,
        key: r.key,
        body: r.body,
        sig: r.sig,
    };
}

function decodeBase64(text: string, what: string): Buffer {
    const bytes = Buffer.from(text, "base64");
    // Buffer.from skips what isn't base64; a canonical round trip refuses it
    if (bytes.toString("base64") !== text) fail(`A record's ${what} is not canonical base64`);
    return bytes;
}

function str(s: string): Buffer {
    const bytes = Buffer.from(s, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(bytes.length);
    return Buffer.concat([len, bytes]);
}

export function headerBytes(h: RecordHeader): Buffer {
    const clock = Buffer.alloc(12);
    clock.writeBigUInt64BE(BigInt(h.wall), 0);
    clock.writeUInt32BE(h.counter, 8);
    const epoch = Buffer.alloc(4);
    epoch.writeUInt32BE(h.epoch);
    return Buffer.concat([MAGIC, str(h.space), str(h.id), clock, str(h.author), Buffer.from([h.deleted ? 1 : 0]), epoch, str(h.key)]);
}

export function signedBytes(h: RecordHeader, body: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([headerBytes(h), len, body]);
}

export function headerOf(r: WireRecord): RecordHeader {
    return { space: r.space, id: r.id, wall: r.wall, counter: r.counter, author: r.author, deleted: r.deleted, epoch: r.epoch, key: r.key };
}

/** SHA-256 of the signed bytes, as hex: a record's identity. */
export function recordDigest(r: WireRecord): string {
    return crypto.createHash("sha256").update(signedBytes(r, Buffer.from(r.body, "base64"))).digest("hex");
}

export function signRecord(h: RecordHeader, body: Buffer, privateKey: crypto.KeyObject): WireRecord {
    const sig = crypto.sign("sha256", signedBytes(h, body), { key: privateKey, dsaEncoding: "ieee-p1363" });
    return { v: 1, ...h, body: body.toString("base64"), sig: sig.toString("base64") };
}

/** Whether `r` was signed by the key in `certPem`. The caller checks the certificate is the author's. */
export function verifyRecord(r: WireRecord, certPem: string): boolean {
    const publicKey = new crypto.X509Certificate(certPem).publicKey;
    return crypto.verify("sha256", signedBytes(r, Buffer.from(r.body, "base64")), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(r.sig, "base64"));
}

/** -1, 0 or 1 as `a` sorts before, with, or after `b` among versions of one record. Equal only for the same digest. */
export function compareRecords(a: { record: WireRecord; digest: string }, b: { record: WireRecord; digest: string }): number {
    const x = a.record;
    const y = b.record;
    if (x.wall !== y.wall) return x.wall < y.wall ? -1 : 1;
    if (x.counter !== y.counter) return x.counter < y.counter ? -1 : 1;
    if (x.author !== y.author) return x.author < y.author ? -1 : 1;
    if (a.digest !== b.digest) return a.digest < b.digest ? -1 : 1;
    return 0;
}

// ─── Network keys ────────────────────────────────────────────────────────────

export function keyIdOf(key: Buffer): string {
    return crypto.createHash("sha256").update("paperboard-network-key-id").update(key).digest("hex").slice(0, 16);
}

export function newNetworkKey(epoch: number): NetworkKey {
    if (!isUint(epoch, 0xffff_ffff)) throw new Error(`Invalid key epoch ${epoch}`);
    const key = crypto.randomBytes(NETWORK_KEY_BYTES);
    return { epoch, id: keyIdOf(key), key };
}

function gcmSeal(key: Buffer, aad: Buffer, plaintext: Buffer): Buffer {
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

/** Opens what gcmSeal sealed; throws when the key is wrong or a byte changed. */
function gcmOpen(key: Buffer, aad: Buffer, sealed: Buffer): Buffer {
    const nonce = sealed.subarray(0, NONCE_BYTES);
    const tag = sealed.subarray(sealed.length - TAG_BYTES);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)), decipher.final()]);
}

export function sealBody(h: RecordHeader, key: NetworkKey, value: unknown): Buffer {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("A record's value must be JSON");
    return gcmSeal(key.key, headerBytes(h), Buffer.from(json, "utf8"));
}

export function openBody(r: WireRecord, key: NetworkKey): unknown {
    return JSON.parse(gcmOpen(key.key, headerBytes(r), Buffer.from(r.body, "base64")).toString("utf8"));
}

// A "@keys" record's body carries every network key its author holds to
// one recipient, so a computer that joins late, or was offline through a
// rotation, can read every record still around:
//
//   body = eph(91) ‖ nonce(12) ‖ AES-256-GCM(k, nonce, aad = header,
//                                            (u32(epoch) ‖ key(32))*) ‖ tag(16)
//   eph  = a fresh P-256 public key, SubjectPublicKeyInfo DER
//   k    = HKDF-SHA256(ikm = ECDH(eph, the recipient's TLS key),
//                      salt = eph,
//                      info = "paperboard-network-keys-v1" ‖ 0x00 ‖ record id)
//
// The recipient derives k from its TLS private key and eph. The record's
// signature says who wrapped the keys; the id binds k to this recipient and
// creator.
const WRAP_INFO = "paperboard-network-keys-v1\0";

function wrapKey(shared: Buffer, eph: Buffer, id: string): Buffer {
    return Buffer.from(crypto.hkdfSync("sha256", shared, eph, Buffer.from(WRAP_INFO + id, "utf8"), 32));
}

export function wrapKeys(h: RecordHeader, recipientCert: string, keys: NetworkKey[]): Buffer {
    if (!keys.length) throw new Error("There are no network keys to share");
    const ephemeral = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const eph = ephemeral.publicKey.export({ type: "spki", format: "der" });
    const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: new crypto.X509Certificate(recipientCert).publicKey });
    const plaintext = Buffer.concat(
        keys.map((k) => {
            const epoch = Buffer.alloc(4);
            epoch.writeUInt32BE(k.epoch);
            return Buffer.concat([epoch, k.key]);
        }),
    );
    return Buffer.concat([eph, gcmSeal(wrapKey(shared, eph, h.id), headerBytes(h), plaintext)]);
}

/** The keys a "@keys" record carries to the holder of `privateKey`; throws if they aren't its to open. */
export function unwrapKeys(r: WireRecord, privateKey: crypto.KeyObject): NetworkKey[] {
    const body = Buffer.from(r.body, "base64");
    const eph = body.subarray(0, SPKI_BYTES);
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: eph, format: "der", type: "spki" }) });
    const plaintext = gcmOpen(wrapKey(shared, eph, r.id), headerBytes(r), body.subarray(SPKI_BYTES));
    const entry = 4 + NETWORK_KEY_BYTES;
    if (plaintext.length === 0 || plaintext.length % entry !== 0) throw new Error(`The keys in ${KEYS_SPACE}/${r.id} are malformed`);
    const keys: NetworkKey[] = [];
    for (let at = 0; at < plaintext.length; at += entry) {
        const key = Buffer.from(plaintext.subarray(at + 4, at + entry));
        keys.push({ epoch: plaintext.readUInt32BE(at), id: keyIdOf(key), key });
    }
    return keys;
}
