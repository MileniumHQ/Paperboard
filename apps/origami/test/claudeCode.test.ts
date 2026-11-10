import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    buildLatestClaudeCodeRecord,
    CLAUDE_PLATFORM,
    gpgVerify,
    liveIo,
    SIGNING_FINGERPRINT,
    type ClaudeCodeIo,
} from "../scripts/update-claude-code";
import { PLATFORM_KEYS, type PlatformKey } from "../scripts/lib/records";
import { resetUpstream, serve, upstreamFetch } from "./helpers/upstream";

const RELEASES = "https://downloads.claude.ai/claude-code-releases";
const KEY_URL = "https://downloads.claude.ai/keys/claude-code.asc";
const VERSION = "2.1.40";

let work: string;
let gnupg: string;
let signer: { fpr: string; armored: string };
let foreign: { fpr: string; armored: string };

function gpg(args: string[]): string {
    const ran = Bun.spawnSync(["gpg", "--batch", "--no-tty", "--pinentry-mode", "loopback", "--passphrase", "", ...args], {
        env: { ...process.env, GNUPGHOME: gnupg, LC_ALL: "C" },
        stdout: "pipe",
        stderr: "pipe",
    });
    if (ran.exitCode !== 0) throw new Error(`gpg ${args.join(" ")} failed: ${ran.stderr.toString()}`);
    return ran.stdout.toString();
}

function newKey(uid: string): { fpr: string; armored: string } {
    gpg(["--quick-gen-key", uid, "ed25519", "sign", "never"]);
    const fpr = gpg(["--with-colons", "--list-keys", uid])
        .split("\n")
        .find((line) => line.startsWith("fpr:"))!
        .split(":")[9]!;
    return { fpr, armored: gpg(["--armor", "--export", fpr]) };
}

async function detachSign(fpr: string, bytes: Uint8Array): Promise<Uint8Array> {
    const file = path.join(work, `to-sign-${Math.random().toString(36).slice(2)}`);
    await writeFile(file, bytes);
    gpg(["--local-user", fpr, "--detach-sign", "--output", `${file}.sig`, file]);
    return new Uint8Array(await readFile(`${file}.sig`));
}

beforeAll(async () => {
    work = await mkdtemp(path.join(tmpdir(), "origami-claude-test-"));
    gnupg = path.join(work, "gnupg");
    await mkdir(gnupg, { mode: 0o700 });
    signer = newKey("Test Release Signing <signer@paperboard.test>");
    foreign = newKey("Someone Else <foreign@paperboard.test>");
}, 60_000);

afterAll(async () => {
    // the signing agent this suite started lives in its own GNUPGHOME
    const killed = Bun.spawnSync(["gpgconf", "--kill", "gpg-agent"], { env: { ...process.env, GNUPGHOME: gnupg }, stderr: "pipe" });
    if (killed.exitCode !== 0) throw new Error(`could not stop the test gpg-agent: ${killed.stderr.toString()}`);
    await rm(work, { recursive: true, force: true });
});

beforeEach(resetUpstream);

const manifestBytes = (manifest: unknown) => new TextEncoder().encode(JSON.stringify(manifest));

// Claude Code records come only from Anthropic's signed manifest, and gpg fails closed.
describe("Claude Code records come only from Anthropic's signed manifest, and gpg fails closed", () => {
    describe("gpgVerify with real gpg", () => {
        test("a good signature returns the signing key's primary fingerprint", async () => {
            const manifest = manifestBytes({ version: VERSION });
            expect(await gpgVerify(manifest, await detachSign(signer.fpr, manifest), signer.armored)).toBe(signer.fpr);
        });

        test("a changed manifest, a foreign key, garbage signature bytes or an unimportable key are refused", async () => {
            const manifest = manifestBytes({ version: VERSION });
            const signature = await detachSign(signer.fpr, manifest);
            await expect(gpgVerify(manifestBytes({ version: "9.9.9" }), signature, signer.armored)).rejects.toThrow(/does not verify \(BADSIG\)/);
            // signed by a key other than the one supplied
            await expect(gpgVerify(manifest, await detachSign(foreign.fpr, manifest), signer.armored)).rejects.toThrow(/does not verify/);
            await expect(gpgVerify(manifest, new TextEncoder().encode("garbage, not an OpenPGP packet"), signer.armored)).rejects.toThrow(/does not verify|no valid signature/);
            await expect(gpgVerify(manifest, signature, "-----BEGIN PGP PUBLIC KEY BLOCK-----\nnot a key\n-----END PGP PUBLIC KEY BLOCK-----\n")).rejects.toThrow(/could not import/);
        });

        test("a missing gpg fails instead of skipping the check", async () => {
            const manifest = manifestBytes({ version: VERSION });
            const signature = await detachSign(signer.fpr, manifest);
            const empty = path.join(work, "empty-bin");
            await mkdir(empty, { recursive: true });
            const savedPath = process.env.PATH;
            process.env.PATH = empty;
            try {
                await expect(gpgVerify(manifest, signature, signer.armored)).rejects.toThrow(/gpg is not installed/);
            } finally {
                process.env.PATH = savedPath;
            }
        });
    });

    describe("the record", () => {
        let tarballs: Record<PlatformKey, { bytes: Uint8Array; binary: string }>;

        beforeAll(async () => {
            tarballs = {} as typeof tarballs;
            for (const key of PLATFORM_KEYS) {
                const name = key.startsWith("windows-") ? "claude.exe" : "claude";
                const root = path.join(work, "npm", key);
                await mkdir(path.join(root, "package"), { recursive: true });
                const binary = `claude binary for ${key}`;
                await writeFile(path.join(root, "package", name), binary);
                await writeFile(path.join(root, "package", "LICENSE.md"), "licence");
                await writeFile(path.join(root, "package", "package.json"), "{}");
                const out = path.join(root, "package.tgz");
                const tar = Bun.spawnSync(["tar", "-czf", out, "-C", root, "package"], { stderr: "pipe" });
                if (tar.exitCode !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`);
                tarballs[key] = { bytes: new Uint8Array(await readFile(out)), binary };
            }
        });

        function manifestFor(checksumOf: (key: PlatformKey) => string = (key) => createHash("sha256").update(tarballs[key].binary).digest("hex")) {
            return {
                version: VERSION,
                platforms: Object.fromEntries(
                    PLATFORM_KEYS.map((key) => [CLAUDE_PLATFORM[key], { binary: key.startsWith("windows-") ? "claude.exe" : "claude", checksum: checksumOf(key) }]),
                ),
            };
        }

        async function serveRelease(manifest: unknown, options: { tamper?: PlatformKey; badShasum?: PlatformKey; signWith?: string } = {}) {
            const bytes = manifestBytes(manifest);
            serve(`${RELEASES}/stable`, `${VERSION}\n`);
            serve(`${RELEASES}/${VERSION}/manifest.json`, bytes);
            serve(`${RELEASES}/${VERSION}/manifest.json.sig`, await detachSign(options.signWith ?? signer.fpr, bytes));
            serve(KEY_URL, options.signWith === foreign.fpr ? foreign.armored : signer.armored);
            for (const key of PLATFORM_KEYS) {
                const pkg = `@anthropic-ai/claude-code-${CLAUDE_PLATFORM[key]}`;
                const tarball = `https://registry.npmjs.org/${pkg}/-/claude-code-${CLAUDE_PLATFORM[key]}-${VERSION}.tgz`;
                const bytesOf = tarballs[key].bytes;
                serve(`https://registry.npmjs.org/${pkg}/${VERSION}`, {
                    name: pkg,
                    version: VERSION,
                    dist: {
                        tarball,
                        integrity: `sha512-${createHash("sha512").update(bytesOf).digest("base64")}`,
                        shasum: key === options.badShasum ? "0".repeat(40) : createHash("sha1").update(bytesOf).digest("hex"),
                    },
                });
                // a tampered download is another real tarball, not the one the registry hashed
                serve(tarball, key === options.tamper ? tarballs[key === "linux-x64" ? "linux-arm64" : "linux-x64"].bytes : bytesOf);
            }
        }

        /**
         * Real gpg checks the signature. The suite's signing key stands in for
         * Anthropic's, whose private half it cannot hold: a verified signature
         * by exactly that key is reported as the pinned fingerprint.
         */
        function io(): ClaudeCodeIo {
            const live = liveIo(upstreamFetch);
            return {
                ...live,
                async verifySignature(manifest, signature, publicKey) {
                    const fpr = await gpgVerify(manifest, signature, publicKey);
                    return fpr === signer.fpr ? SIGNING_FINGERPRINT : fpr;
                },
            };
        }

        test("a signed manifest and matching npm tarballs build a record over the tarballs", async () => {
            await serveRelease(manifestFor());
            const record = await buildLatestClaudeCodeRecord("stable", io());
            expect(record.version).toBe(VERSION);
            for (const key of PLATFORM_KEYS) {
                expect(record.platforms[key]?.sha256).toBe(createHash("sha256").update(tarballs[key].bytes).digest("hex"));
            }
            expect(record.platforms["windows-x64"]?.recipe?.take).toEqual({ "bin/claude.exe": "package/claude.exe", "LICENSE.md": "package/LICENSE.md" });
        });

        test("a manifest signed by any other key is refused", async () => {
            await serveRelease(manifestFor(), { signWith: foreign.fpr });
            await expect(buildLatestClaudeCodeRecord("stable", io())).rejects.toThrow(/not Anthropic's pinned key/);
            // and with no stand-in at all, the suite's own key is not Anthropic's either
            resetUpstream();
            await serveRelease(manifestFor());
            await expect(buildLatestClaudeCodeRecord("stable", liveIo(upstreamFetch))).rejects.toThrow(/not Anthropic's pinned key/);
        });

        test("a tarball that differs from the registry's sha512 or sha1 is refused", async () => {
            await serveRelease(manifestFor(), { tamper: "linux-arm64" });
            await expect(buildLatestClaudeCodeRecord("stable", io())).rejects.toThrow(/linux-arm64: tarball sha512 differs/);
            resetUpstream();
            await serveRelease(manifestFor(), { badShasum: "windows-arm64" });
            await expect(buildLatestClaudeCodeRecord("stable", io())).rejects.toThrow(/win32-arm64: tarball sha1 differs/);
        });

        test("a binary that differs from the signed manifest's checksum is refused", async () => {
            await serveRelease(manifestFor((key) => (key === "macos-arm64" ? "0".repeat(64) : createHash("sha256").update(tarballs[key].binary).digest("hex"))));
            await expect(buildLatestClaudeCodeRecord("stable", io())).rejects.toThrow(/darwin-arm64: the binary inside the tarball differs/);
        });
    });
});
