// Refreshes the `codex` record (the Codex CLI the Agent panel drives) to the
// latest stable release of openai/codex.
//
//   bun run update:codex              latest stable (no drafts/prereleases)
//   bun run update:codex -- --dry-run print, don't write
//
// Paperboard does not host Codex. Each entry points at OpenAI's own GitHub
// asset, codex-package-<triple>.tar.gz, with a recipe that takes the parts
// of the package Codex needs. The .tar.gz is used, not the smaller .tar.zst:
// only the .tar.gz files are listed in the release's codex-package_SHA256SUMS.
//
// What the packages hold (listed from the real 0.166.0 archives, one per
// target; no archive contains a symlink):
//   every target   bin/codex[.exe], bin/codex-code-mode-host[.exe],
//                  bin/codex-exec-server[.exe], codex-package.json,
//                  codex-path/rg[.exe], codex-resources/voice/** (~50 MB of
//                  GStreamer libraries; Codex starts, signs in and runs
//                  `exec` without it, so it is not taken)
//   linux          codex-resources/bwrap (the sandbox helper)
//   macOS          nothing else in codex-resources besides voice/
//   windows        codex-resources/codex-command-runner.exe and
//                  codex-resources/codex-windows-sandbox-setup.exe (the
//                  sandbox helpers)
// A `take` source that is not in the archive would only fail on the user's
// computer, so the updater lists every archive and refuses the whole record
// if any source is missing.
//
// Trust: GitHub is the authority for openai/codex release assets. Each
// asset's sha256 comes from GitHub's asset digest and must agree with the
// release's codex-package_SHA256SUMS. The downloaded bytes are hashed too:
// listing an archive proves nothing about a file whose hash is unchecked.
// A missing or disagreeing fact drops the whole record.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
import { parseSha256Sums, type GithubRelease } from "./update-ollama";

const LATEST = "https://api.github.com/repos/openai/codex/releases/latest";
const SUMS_FILE = "codex-package_SHA256SUMS";

const COMMON_TAKES: Record<string, string> = {
    bin: "bin",
    "codex-package.json": "codex-package.json",
    "codex-path": "codex-path",
};

function takes(...extra: string[]): Record<string, string> {
    return { ...COMMON_TAKES, ...Object.fromEntries(extra.map((p) => [p, p])) };
}

export const TARGETS: Record<PlatformKey, { triple: string; take: Record<string, string> }> = {
    "linux-x64": { triple: "x86_64-unknown-linux-musl", take: takes("codex-resources/bwrap") },
    "linux-arm64": { triple: "aarch64-unknown-linux-musl", take: takes("codex-resources/bwrap") },
    "macos-x64": { triple: "x86_64-apple-darwin", take: takes() },
    "macos-arm64": { triple: "aarch64-apple-darwin", take: takes() },
    "windows-x64": {
        triple: "x86_64-pc-windows-msvc",
        take: takes("codex-resources/codex-command-runner.exe", "codex-resources/codex-windows-sandbox-setup.exe"),
    },
    "windows-arm64": {
        triple: "aarch64-pc-windows-msvc",
        take: takes("codex-resources/codex-command-runner.exe", "codex-resources/codex-windows-sandbox-setup.exe"),
    },
};

/** One platform's archive as the release publishes it. */
export interface CodexDownload {
    key: PlatformKey;
    file: string;
    url: string;
    sha256: string;
}

/** Member paths of an archive, as `tar -t` prints them. */
export type ArchiveListings = Record<PlatformKey, string[]>;

/** Downloads one archive, checks its sha256, and returns its member paths. */
export type ArchiveInspector = (download: CodexDownload) => Promise<string[]>;

/** The release's per-platform archives, each with the one sha256 GitHub and SHA256SUMS agree on. */
export function codexDownloads(release: GithubRelease, sumsText: string): { version: string; downloads: (CodexDownload & { size?: number })[] } {
    if (release.draft || release.prerelease) {
        throw new Error(`${release.tag_name} is not a stable release`);
    }
    const version = release.tag_name.replace(/^rust-v/, "");
    if (!release.tag_name.startsWith("rust-v") || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
    }
    const sums = parseSha256Sums(sumsText);
    const downloads = PLATFORM_KEYS.map((key) => {
        const file = `codex-package-${TARGETS[key].triple}.tar.gz`;
        const asset = release.assets.find((a) => a.name === file);
        if (!asset) throw new Error(`${release.tag_name}: asset ${file} missing`);
        const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
        if (!digest) throw new Error(`${release.tag_name}: ${file} has no sha256 digest`);
        const listed = sums.get(file);
        if (!listed) throw new Error(`${release.tag_name}: ${file} is not in ${SUMS_FILE}`);
        if (listed !== digest) {
            throw new Error(`${release.tag_name}: ${file} digest disagrees with ${SUMS_FILE}`);
        }
        return { key, file, url: asset.browser_download_url, sha256: digest, ...(typeof asset.size === "number" ? { size: asset.size } : {}) };
    });
    return { version, downloads };
}

function hasMember(members: Set<string>, source: string): boolean {
    if (members.has(source)) return true;
    for (const member of members) if (member.startsWith(`${source}/`)) return true;
    return false;
}

export function buildCodexRecord(release: GithubRelease, sumsText: string, listings: ArchiveListings): PackageRecord {
    const { version, downloads } = codexDownloads(release, sumsText);
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const { key, file, url, sha256, size } of downloads) {
        const listing = listings[key];
        if (!listing?.length) throw new Error(`${file}: no archive listing`);
        const members = new Set(listing.map((p) => p.replace(/^\.\//, "").replace(/\/+$/, "")));
        for (const source of Object.values(TARGETS[key].take)) {
            if (!hasMember(members, source)) throw new Error(`${file}: ${source} is not in the archive`);
        }
        const recipe: PackageRecipe = { unpack: "tar", take: TARGETS[key].take };
        platforms[key] = { url, sha256, ...(size === undefined ? {} : { size }), recipe };
    }
    const record: PackageRecord = { name: "codex", version, platforms };
    assertValidRecord(record);
    return record;
}

function listArchive(archive: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        // argv array, no shell; -t only lists, nothing is extracted or run
        execFile("tar", ["-tzf", archive], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`tar -tzf failed: ${stderr.trim() || err.message}`));
                return;
            }
            resolve(stdout.split("\n").filter(Boolean));
        });
    });
}

/**
 * Streams the archive into a temp file, refuses it unless its bytes hash to
 * the digest the release claims, lists its members with `tar -t`, and
 * deletes it. Nothing in the archive is extracted or run.
 */
export function inspectArchive(fetchFn: typeof fetch = fetch): ArchiveInspector {
    return async ({ file, url, sha256 }) => {
        const dir = await mkdtemp(path.join(tmpdir(), "origami-codex-"));
        try {
            const res = await fetchFn(url, { headers: { "User-Agent": "Origami-Package-Updater/2.0" }, redirect: "follow" });
            if (!res.ok || !res.body) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
            const archive = path.join(dir, file);
            const hash = createHash("sha256");
            const tap = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    hash.update(chunk);
                    controller.enqueue(chunk);
                },
            });
            await pipeline(Readable.fromWeb(res.body.pipeThrough(tap) as never), createWriteStream(archive));
            const actual = hash.digest("hex");
            if (actual !== sha256) throw new Error(`${file}: downloaded bytes hash to ${actual}, not the published ${sha256}`);
            return await listArchive(archive);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    };
}

export async function buildLatestCodexRecord(
    fetchFn: typeof fetch = fetch,
    inspect: ArchiveInspector = inspectArchive(fetchFn),
): Promise<PackageRecord> {
    const release = await fetchJson<GithubRelease>(LATEST, fetchFn, {
        Accept: "application/vnd.github+json",
    });
    const sumsAsset = release.assets?.find((a) => a.name === SUMS_FILE);
    if (!sumsAsset) throw new Error(`${release.tag_name}: ${SUMS_FILE} missing`);
    const sumsText = await fetchText(sumsAsset.browser_download_url, fetchFn);
    const { downloads } = codexDownloads(release, sumsText);
    const listings = {} as ArchiveListings;
    await Promise.all(downloads.map(async (d) => (listings[d.key] = await inspect(d))));
    return buildCodexRecord(release, sumsText, listings);
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "codex", record: await buildLatestCodexRecord() };
    } catch (err) {
        built = { key: "codex", error: err instanceof Error ? err.message : String(err) };
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
