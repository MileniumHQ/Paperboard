// Offline release signing for publish.ts and the origami package scripts.
// The private key lives outside the repository and the registry:
//   PAPERBOARD_RELEASE_KEY=<path>  or  ~/.config/paperboard/release-signing.pem
// Clients verify against RELEASE_PUBLIC_KEY in
// apps/paperboard/papercrane/releaseSignature.ts (one implementation of the
// canonical messages, shared by signer and verifier).
//
//   bun scripts/releaseSigning.ts keygen   # new key; prints the public key
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export { releaseMessage } from "../apps/paperboard/papercrane/releaseSignature";

export function releaseKeyPath(): string {
    return process.env.PAPERBOARD_RELEASE_KEY || path.join(os.homedir(), ".config", "paperboard", "release-signing.pem");
}

export function loadReleaseSigningKey(file = releaseKeyPath()): crypto.KeyObject {
    let pem: string;
    try {
        pem = fs.readFileSync(file, "utf8");
    } catch (err) {
        throw new Error(
            `No release signing key at ${file} (${(err as Error).message}). Releases are not published unsigned: ` +
                "restore the key from your offline backup, or set PAPERBOARD_RELEASE_KEY.",
        );
    }
    const key = crypto.createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`${file} is not an ed25519 key`);
    return key;
}

export function signRelease(key: crypto.KeyObject, msg: Buffer): string {
    return Buffer.from(crypto.sign(null, msg, key)).toString("base64");
}

// writes a new key (0600, refusing to overwrite) and returns the public PEM
export function generateReleaseKey(file = releaseKeyPath()): string {
    if (fs.existsSync(file)) throw new Error(`${file} already exists; refusing to overwrite a release key`);
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    return publicKey.export({ type: "spki", format: "pem" }).toString();
}

if (import.meta.main && process.argv[2] === "keygen") {
    const file = releaseKeyPath();
    const pub = generateReleaseKey(file);
    console.log(`Release signing key written to ${file} (0600). Back it up offline.`);
    console.log("Public key for apps/paperboard/papercrane/releaseSignature.ts RELEASE_PUBLIC_KEY:\n");
    console.log(pub);
}
