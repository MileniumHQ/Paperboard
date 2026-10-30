// Refreshes standalone GE-Proton (Valve Proton is distributed via Steam).
// bun run update:proton -- --dry-run prints without writing.
// Trust: GitHub's asset sha256 digest is the authority, like Helium.
// Require and parse each release's matching .sha512sum, but do not claim
// cross-verification: comparing sha512 with sha256 is impossible without
// downloading and hashing the ~600 MB archive. The updater only downloads
// metadata/checksum files; the daemon verifies the archive's sha256.
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, fetchJson, fetchText, PLATFORM_KEYS, type PackageRecord, type PlatformKey, type PlatformDownload } from "./lib/records";
import type { GithubRelease } from "./update-ollama";

const LATEST = "https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest";
const ARCH: Partial<Record<PlatformKey, string>> = { "linux-x64": "x86_64", "linux-arm64": "aarch64" };

export function buildProtonRecord(release: GithubRelease, sums: Record<string, string>): PackageRecord {
    if (release.draft || release.prerelease) throw new Error(`${release.tag_name} is not a stable release`);
    if (!/^GE-Proton[1-9]\d*-[1-9]\d*$/.test(release.tag_name)) throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const arch = ARCH[key];
        if (!arch) continue;
        const stem = `${release.tag_name}-${arch}`;
        const file = `${stem}.tar.gz`;
        const asset = release.assets.find((a) => a.name === file);
        if (!asset) throw new Error(`${release.tag_name}: asset ${file} missing`);
        const digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
        if (!digest) throw new Error(`${file} has no sha256 digest`);
        const checksum = `${stem}.sha512sum`;
        if (!release.assets.some((a) => a.name === checksum)) throw new Error(`${checksum} missing`);
        const match = sums[checksum]?.trim().match(/^([a-f0-9]{128})\s+\*?(?:\.\/)?([^\r\n]+)$/i);
        if (!match || match[2] !== file) throw new Error(`${checksum} missing or malformed checksum for ${file}`);
        platforms[key] = { url: asset.browser_download_url, sha256: digest, ...(typeof asset.size === "number" ? { size: asset.size } : {}), recipe: { unpack: "tar", take: { bin: stem } } };
    }
    const record: PackageRecord = { name: "proton", version: release.tag_name, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestProtonRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const release = await fetchJson<GithubRelease>(LATEST, fetchFn, { Accept: "application/vnd.github+json" });
    // Validate release metadata before fetching any checksum URLs.
    if (release.draft || release.prerelease) throw new Error(`${release.tag_name} is not a stable release`);
    if (!/^GE-Proton[1-9]\d*-[1-9]\d*$/.test(release.tag_name)) throw new Error(`unexpected release tag ${JSON.stringify(release.tag_name)}`);
    const sums: Record<string, string> = {};
    for (const arch of Object.values(ARCH)) {
        const name = `${release.tag_name}-${arch}.sha512sum`;
        const asset = release.assets.find((a) => a.name === name);
        if (!asset) throw new Error(`${name} missing`);
        sums[name] = await fetchText(asset.browser_download_url, fetchFn);
    }
    return buildProtonRecord(release, sums);
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "proton", record: await buildLatestProtonRecord() };
    } catch (err) {
        built = { key: "proton", error: err instanceof Error ? err.message : String(err) };
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
