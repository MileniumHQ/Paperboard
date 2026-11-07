// Refreshes the `claude-code` record (the Claude Code CLI the Agent panel
// drives) to Anthropic's current release.
//
//   bun run update:claude-code                       the `stable` channel
//   bun run update:claude-code -- --channel latest   the `latest` channel
//   bun run update:claude-code -- --dry-run          print, don't write
//
// Paperboard does not host Claude Code. The bytes come from Anthropic's own
// per-platform npm packages (@anthropic-ai/claude-code-<platform>, plain
// .tgz files with no install scripts), each holding the unmodified binary as
// package/claude (package/claude.exe on Windows) beside its LICENSE.md. A
// tar recipe puts the binary in bin/ and keeps the licence notice with it.
//
// Platforms: darwin, linux (glibc) and win32, x64 and arm64. The musl
// packages are not used: a package record has no libc dimension, and the
// glibc build does not run on musl.
//
// Trust: two independent authorities must agree, or the whole record fails.
//   1. Anthropic's manifest.json for the version is verified against its
//      detached GPG signature (manifest.json.sig), with the key published at
//      downloads.claude.ai/keys. The signing key's primary fingerprint is
//      pinned below; the human-readable gpg output is never trusted, only the
//      machine-readable status lines.
//   2. Each npm tarball is hashed (sha512 and sha1) and must match the
//      registry's dist.integrity and dist.shasum, and the sha256 of the
//      binary inside it must equal the signed manifest's checksum for that
//      platform.
// The record's sha256 is that of the .tgz itself: it is what the daemon
// downloads and checks at install. Needs `gpg` on the operator's machine.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { writeRecords, report } from "./lib/cli";
import {
    assertValidRecord,
    fetchJson,
    fetchText,
    PLATFORM_KEYS,
    type PackageRecipe,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";

const RELEASES = "https://downloads.claude.ai/claude-code-releases";
const KEY_URL = "https://downloads.claude.ai/keys/claude-code.asc";
const REGISTRY = "https://registry.npmjs.org";

/** Primary fingerprint of Anthropic's "Claude Code Release Signing" key. */
export const SIGNING_FINGERPRINT = "31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE";

export const CHANNELS = ["stable", "latest"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Package platform → Anthropic's platform name (manifest key and npm package suffix). */
export const CLAUDE_PLATFORM: Record<PlatformKey, string> = {
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "macos-x64": "darwin-x64",
    "macos-arm64": "darwin-arm64",
    "windows-x64": "win32-x64",
    "windows-arm64": "win32-arm64",
};

const binaryName = (key: PlatformKey) => (key.startsWith("windows-") ? "claude.exe" : "claude");

function recipeFor(key: PlatformKey): PackageRecipe {
    const binary = binaryName(key);
    return { unpack: "tar", take: { [`bin/${binary}`]: `package/${binary}`, "LICENSE.md": "package/LICENSE.md" } };
}

export interface NpmPackument {
    name?: string;
    version?: string;
    dist?: { tarball?: string; integrity?: string; shasum?: string };
}

export interface ClaudeManifest {
    version?: string;
    platforms?: Record<string, { binary?: string; checksum?: string }>;
}

/** What hashing and listing one npm tarball produced. */
export interface TarballFacts {
    size: number;
    sha1: string;
    sha256: string;
    /** base64 sha512, as npm's `sha512-…` integrity writes it */
    sha512: string;
    /** member paths of the tarball */
    members: string[];
    /** sha256 of the member named by `binaryMember` */
    binarySha256: string;
}

/** Everything the updater needs from outside; tests replace it. */
export interface ClaudeCodeIo {
    text(url: string): Promise<string>;
    json<T>(url: string): Promise<T>;
    bytes(url: string): Promise<Uint8Array>;
    /** Verifies a detached signature with gpg; returns the signing key's primary fingerprint. */
    verifySignature(manifest: Uint8Array, signature: Uint8Array, publicKey: string): Promise<string>;
    /** Downloads the tarball, hashes it, lists it and hashes `binaryMember` inside it. */
    inspectTarball(url: string, binaryMember: string): Promise<TarballFacts>;
}

function expectHex(value: unknown, length: number, what: string): string {
    if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
        throw new Error(`${what} is missing or malformed`);
    }
    return value;
}

/** Facts for one platform, checked against both authorities; throws on any disagreement. */
function platformDownload(
    version: string,
    key: PlatformKey,
    manifest: ClaudeManifest,
    packument: NpmPackument,
    facts: TarballFacts,
): PlatformDownload {
    const claude = CLAUDE_PLATFORM[key];
    const where = `claude-code ${version} ${claude}`;
    const entry = manifest.platforms?.[claude];
    if (!entry) throw new Error(`${where}: not in the signed manifest`);
    if (entry.binary !== binaryName(key)) {
        throw new Error(`${where}: the manifest names the binary ${JSON.stringify(entry.binary)}, expected ${binaryName(key)}`);
    }
    const checksum = expectHex(entry.checksum, 64, `${where}: manifest checksum`);

    if (packument.name !== `@anthropic-ai/claude-code-${claude}`) {
        throw new Error(`${where}: the registry answered for ${JSON.stringify(packument.name)}`);
    }
    if (packument.version !== version) {
        throw new Error(`${where}: the registry answered for version ${JSON.stringify(packument.version)}`);
    }
    const tarball = packument.dist?.tarball;
    if (!tarball || new URL(tarball).protocol !== "https:") throw new Error(`${where}: the registry gave no https tarball url`);
    const integrity = packument.dist?.integrity?.split(/\s+/).find((h) => h.startsWith("sha512-"));
    if (!integrity) throw new Error(`${where}: the registry gave no sha512 integrity`);
    if (integrity !== `sha512-${facts.sha512}`) throw new Error(`${where}: tarball sha512 differs from the registry's integrity`);
    if (expectHex(packument.dist?.shasum, 40, `${where}: registry shasum`) !== facts.sha1) {
        throw new Error(`${where}: tarball sha1 differs from the registry's shasum`);
    }

    const recipe = recipeFor(key);
    const members = new Set(facts.members.map((m) => m.replace(/^\.\//, "").replace(/\/+$/, "")));
    for (const source of Object.values(recipe.take)) {
        if (!members.has(source)) throw new Error(`${where}: ${source} is not in the tarball`);
    }
    if (facts.binarySha256 !== checksum) {
        throw new Error(`${where}: the binary inside the tarball differs from the signed manifest's checksum`);
    }
    return { url: tarball, sha256: expectHex(facts.sha256, 64, `${where}: tarball sha256`), size: facts.size, recipe };
}

export function buildClaudeCodeRecord(
    version: string,
    manifest: ClaudeManifest,
    packuments: Record<PlatformKey, NpmPackument>,
    tarballs: Record<PlatformKey, TarballFacts>,
): PackageRecord {
    assertVersion(version);
    if (manifest.version !== version) {
        throw new Error(`claude-code: the signed manifest is for ${JSON.stringify(manifest.version)}, not ${version}`);
    }
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        if (!packuments[key] || !tarballs[key]) throw new Error(`claude-code ${version} ${CLAUDE_PLATFORM[key]}: download missing`);
        platforms[key] = platformDownload(version, key, manifest, packuments[key], tarballs[key]);
    }
    const record: PackageRecord = { name: "claude-code", version, platforms };
    assertValidRecord(record);
    return record;
}

function assertVersion(version: string): void {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`claude-code: unexpected version ${JSON.stringify(version)}`);
}

export async function buildLatestClaudeCodeRecord(
    channel: Channel = "stable",
    io: ClaudeCodeIo = liveIo(),
): Promise<PackageRecord> {
    const version = (await io.text(`${RELEASES}/${channel}`)).trim();
    assertVersion(version);

    const [manifestBytes, signature, publicKey] = await Promise.all([
        io.bytes(`${RELEASES}/${version}/manifest.json`),
        io.bytes(`${RELEASES}/${version}/manifest.json.sig`),
        io.text(KEY_URL),
    ]);
    const signer = (await io.verifySignature(manifestBytes, signature, publicKey)).replace(/\s+/g, "").toUpperCase();
    if (signer !== SIGNING_FINGERPRINT) {
        throw new Error(`claude-code ${version}: manifest is signed by ${signer}, not Anthropic's pinned key ${SIGNING_FINGERPRINT}`);
    }
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ClaudeManifest;

    const packuments = {} as Record<PlatformKey, NpmPackument>;
    const tarballs = {} as Record<PlatformKey, TarballFacts>;
    await Promise.all(
        PLATFORM_KEYS.map(async (key) => {
            const packument = await io.json<NpmPackument>(`${REGISTRY}/@anthropic-ai/claude-code-${CLAUDE_PLATFORM[key]}/${version}`);
            packuments[key] = packument;
            const url = packument.dist?.tarball;
            if (!url) throw new Error(`claude-code ${version} ${CLAUDE_PLATFORM[key]}: the registry gave no tarball url`);
            tarballs[key] = await io.inspectTarball(url, `package/${binaryName(key)}`);
        }),
    );
    return buildClaudeCodeRecord(version, manifest, packuments, tarballs);
}

interface Ran {
    code: number | null;
    stdout: string;
    stderr: string;
}

// argv array, no shell
async function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<Ran> {
    const proc = Bun.spawn([command, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, stdout, stderr };
}

const BAD_STATUS = ["BADSIG", "ERRSIG", "EXPSIG", "EXPKEYSIG", "REVKEYSIG", "NO_PUBKEY"];

/**
 * Imports the key into a throwaway GNUPGHOME and verifies the detached
 * signature, reading only gpg's machine-readable status lines. Returns the
 * primary fingerprint of the key that made the signature.
 */
export async function gpgVerify(manifest: Uint8Array, signature: Uint8Array, publicKey: string): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), "origami-gpg-"));
    const env = { ...process.env, GNUPGHOME: home, LC_ALL: "C" };
    let agentMayRun = false;
    try {
        await Promise.all([
            writeFile(path.join(home, "key.asc"), publicKey),
            writeFile(path.join(home, "manifest.json"), manifest),
            writeFile(path.join(home, "manifest.json.sig"), signature),
        ]);
        let imported: Ran;
        let verified: Ran;
        try {
            imported = await run("gpg", ["--batch", "--no-tty", "--import", path.join(home, "key.asc")], env);
            agentMayRun = true;
            if (imported.code !== 0) throw new Error(`gpg could not import Anthropic's key: ${imported.stderr.trim()}`);
            verified = await run(
                "gpg",
                ["--batch", "--no-tty", "--status-fd", "1", "--verify", path.join(home, "manifest.json.sig"), path.join(home, "manifest.json")],
                env,
            );
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                throw new Error("gpg is not installed; it is needed to verify Anthropic's signed manifest");
            }
            throw err;
        }
        const lines = verified.stdout.split("\n").map((l) => l.split(" "));
        const status = (name: string) => lines.filter((l) => l[0] === "[GNUPG:]" && l[1] === name);
        const bad = BAD_STATUS.find((name) => status(name).length > 0);
        if (verified.code !== 0 || bad || status("GOODSIG").length !== 1) {
            throw new Error(`the manifest signature does not verify${bad ? ` (${bad})` : ""}: ${verified.stderr.trim()}`);
        }
        const valid = status("VALIDSIG");
        // VALIDSIG <fpr> <date> <ts> <expire-ts> <version> <reserved> <pubkey-algo> <hash-algo> <class> <primary-fpr>
        const primary = valid.length === 1 ? valid[0]![11] : undefined;
        if (!primary || !/^[A-F0-9]{40}$/.test(primary)) throw new Error("gpg reported no valid signature for the manifest");
        return primary;
    } finally {
        // a gpg-agent started by the import would otherwise outlive the directory
        if (agentMayRun) {
            await run("gpgconf", ["--kill", "gpg-agent"], env).catch((err) => console.warn(`could not stop the throwaway gpg-agent: ${err.message}`));
        }
        await rm(home, { recursive: true, force: true });
    }
}

/** Streams a command's stdout into a sha256 without ever holding it in memory. */
async function sha256OfOutput(command: string, args: string[]): Promise<string> {
    const proc = Bun.spawn([command, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const hash = createHash("sha256");
    const [, stderr, code] = await Promise.all([
        (async () => {
            for await (const chunk of proc.stdout) hash.update(chunk);
        })(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (code !== 0) throw new Error(`${command} failed: ${stderr.trim()}`);
    return hash.digest("hex");
}

/**
 * Streams the tarball to a temp file while hashing it, lists it with
 * `tar -t`, hashes the binary by streaming `tar -xO` to the hash (nothing
 * is written out, nothing is run), and deletes the tarball.
 */
export function inspectTarball(fetchFn: typeof fetch = fetch): ClaudeCodeIo["inspectTarball"] {
    return async (url, binaryMember) => {
        const dir = await mkdtemp(path.join(tmpdir(), "origami-claude-"));
        try {
            const res = await fetchFn(url, { headers: { "User-Agent": "Origami-Package-Updater/2.0" }, redirect: "follow" });
            if (!res.ok || !res.body) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
            const archive = path.join(dir, "package.tgz");
            const hashes = { sha1: createHash("sha1"), sha256: createHash("sha256"), sha512: createHash("sha512") };
            let size = 0;
            const tap = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    size += chunk.byteLength;
                    for (const h of Object.values(hashes)) h.update(chunk);
                    controller.enqueue(chunk);
                },
            });
            await pipeline(Readable.fromWeb(res.body.pipeThrough(tap) as never), createWriteStream(archive));
            const listed = await run("tar", ["-tzf", archive]);
            if (listed.code !== 0) throw new Error(`tar -tzf failed: ${listed.stderr.trim()}`);
            const members = listed.stdout.split("\n").filter(Boolean);
            if (!members.includes(binaryMember)) throw new Error(`${binaryMember} is not in ${url}`);
            return {
                size,
                sha1: hashes.sha1.digest("hex"),
                sha256: hashes.sha256.digest("hex"),
                sha512: hashes.sha512.digest("base64"),
                members,
                binarySha256: await sha256OfOutput("tar", ["-xzOf", archive, binaryMember]),
            };
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    };
}

export function liveIo(fetchFn: typeof fetch = fetch): ClaudeCodeIo {
    return {
        text: (url) => fetchText(url, fetchFn),
        json: (url) => fetchJson(url, fetchFn),
        bytes: async (url) => {
            const res = await fetchFn(url, { headers: { "User-Agent": "Origami-Package-Updater/2.0" }, signal: AbortSignal.timeout(30_000) });
            if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
            return new Uint8Array(await res.arrayBuffer());
        },
        verifySignature: gpgVerify,
        inspectTarball: inspectTarball(fetchFn),
    };
}

function channelArg(argv: string[]): Channel {
    const at = argv.indexOf("--channel");
    if (at === -1) return "stable";
    const value = argv[at + 1];
    if (!(CHANNELS as readonly (string | undefined)[]).includes(value)) {
        throw new Error(`--channel takes ${CHANNELS.join(" or ")}, not ${JSON.stringify(value)}`);
    }
    return value as Channel;
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "claude-code", record: await buildLatestClaudeCodeRecord(channelArg(argv)) };
    } catch (err) {
        built = { key: "claude-code", error: err instanceof Error ? err.message : String(err) };
    }
    return report(await writeRecords([built], { dryRun }), dryRun);
}

if (import.meta.main) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (err) => {
            console.error(err instanceof Error ? err.message : err);
            process.exit(1);
        },
    );
}
