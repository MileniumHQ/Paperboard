// Release signatures: the trust anchor that is not the registry.
//
// The registry hashes the bytes it hosts, but whoever controls the registry
// (its publish key, the Cloudflare account) controls those hashes too. Every
// release fact a client acts on — a panel archive, a runtime package, a
// daemon binary, an app update — is therefore also signed offline with the
// Paperboard release key (ed25519), and clients verify that signature against
// the public key compiled in here before downloading or activating anything.
// A registry compromise without the offline key installs nothing.
//
// The private key never touches the registry or this repository: publish.ts
// and the origami package scripts read it from PAPERBOARD_RELEASE_KEY or
// ~/.config/paperboard/release-signing.pem (see scripts/releaseSigning.ts).
import * as crypto from "crypto";
import { logger } from "./logger";

export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnPZxRUXmI+YzHGY7gJrpx4R+6+Q0nWQxQ9crtJjdxF8=
-----END PUBLIC KEY-----
`;

const DOMAIN = "paperboard-release-v1";
const MAX_SIGNATURE_CHARS = 200;

// One canonical message per release kind. Fields are newline-joined after a
// domain + kind prefix, so a signature for one kind never verifies as
// another, and no field can contain the separator (callers pass validated
// ids, versions and hex/base64 digests).
function message(kind: string, fields: string[]): Buffer {
    for (const field of fields) {
        if (typeof field !== "string" || !field || /[\n\r]/.test(field)) {
            throw new Error(`Invalid ${kind} release field: ${JSON.stringify(field)}`);
        }
    }
    return Buffer.from([DOMAIN, kind, ...fields].join("\n"), "utf8");
}

export const releaseMessage = {
    panel: (id: string, version: string, sha256: string) => message("panel", [id, version, sha256.toLowerCase()]),
    package: (name: string, version: string, platform: string, sha256: string) =>
        message("package", [name, version, platform, sha256.toLowerCase()]),
    // daemon binaries are identified by sha256, app builds by the sha512 the
    // electron-updater feed carries (base64, as the feed writes it)
    crane: (version: string, sha256: string) => message("crane", [version, sha256.toLowerCase()]),
    app: (version: string, file: string, sha512: string) => message("app", [version, file, sha512]),
};

// true only for a well-formed signature by the release key over exactly
// this message; anything else (missing, malformed, wrong key) is false
export function verifyRelease(msg: Buffer, signature: unknown, publicKey: string = RELEASE_PUBLIC_KEY): boolean {
    if (typeof signature !== "string" || !signature || signature.length > MAX_SIGNATURE_CHARS) return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
    try {
        return crypto.verify(null, msg, publicKey, Buffer.from(signature, "base64"));
    } catch (err) {
        // an unusable key or signature encoding is a failed verification
        logger.debug("[release] signature verification could not run:", err);
        return false;
    }
}

// throwing form for install paths: names what was refused and why
export function requireReleaseSignature(msg: Buffer, signature: unknown, what: string, publicKey: string = RELEASE_PUBLIC_KEY): void {
    if (signature === undefined || signature === null || signature === "") {
        throw new Error(`Install refused for ${what}: the release is not signed`);
    }
    if (!verifyRelease(msg, signature, publicKey)) {
        throw new Error(`Install refused for ${what}: the release signature does not verify against the Paperboard release key`);
    }
}
