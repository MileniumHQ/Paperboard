// Refreshes Valve's SteamCMD bootstrap, not its self-updated runtime.
// bun run update:steamcmd -- --dry-run prints without writing.
// Trust: Valve publishes no checksums. These long-lived bootstraps are
// pinned below; every download is hashed and any change refuses the whole
// record. A changed bootstrap requires a reviewed source update.
// Version is the newest pinned bootstrap date, not a Steam runtime version.
// Only x64 hosts are advertised: the macOS binary is x86-only and Rosetta
// availability on arm64 is not guaranteed. Linux's binary needs 32-bit libc.
// Consumers must copy the bootstrap to a mutable workspace before running:
// SteamCMD self-updates in its own directory, never in the package store.
import { createHash } from "node:crypto";
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, PLATFORM_KEYS, type PackageRecipe, type PackageRecord, type PlatformKey, type PlatformDownload } from "./lib/records";

export const STEAMCMD_BUILDS: Partial<Record<PlatformKey, { file: string; sha256: string; recipe: PackageRecipe }>> = {
    "linux-x64": {
        file: "steamcmd_linux.tar.gz",
        sha256: "cebf0046bfd08cf45da6bc094ae47aa39ebf4155e5ede41373b579b8f1071e7c",
        recipe: { unpack: "tar", take: { "bin/steamcmd.sh": "steamcmd.sh", "bin/linux32": "linux32" } },
    },
    "macos-x64": {
        file: "steamcmd_osx.tar.gz",
        sha256: "8ecc17c8988e5acadcc78e631c48490f76150f2dfaa6cf8d7b4b67b097bd753b",
        recipe: { unpack: "tar", take: { "bin/steamcmd": "steamcmd", "bin/steamcmd.sh": "steamcmd.sh", "bin/crashhandler.dylib": "crashhandler.dylib", "bin/Frameworks": "Frameworks" } },
    },
    "windows-x64": {
        file: "steamcmd.zip",
        sha256: "7669b170dee42db8ee2273775ed7dfb2d173bdba1b849f70d2c7b379290bce13",
        recipe: { unpack: "zip", take: { "bin/steamcmd.exe": "steamcmd.exe" } },
    },
};

export function buildSteamcmdRecord(downloads: Partial<Record<PlatformKey, { sha256: string; size: number }>>): PackageRecord {
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const key of PLATFORM_KEYS) {
        const build = STEAMCMD_BUILDS[key];
        if (!build) continue;
        const observed = downloads[key];
        if (!observed) throw new Error(`${build.file}: download missing`);
        if (observed.sha256 !== build.sha256) throw new Error(`${build.file}: sha256 differs from reviewed pin (${observed.sha256})`);
        platforms[key] = { url: `https://steamcdn-a.akamaihd.net/client/installer/${build.file}`, ...observed, recipe: build.recipe };
    }
    const record: PackageRecord = { name: "steamcmd", version: "2020.04.02", platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestSteamcmdRecord(fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const downloads: Partial<Record<PlatformKey, { sha256: string; size: number }>> = {};
    for (const key of PLATFORM_KEYS) {
        const build = STEAMCMD_BUILDS[key];
        if (!build) continue;
        const url = `https://steamcdn-a.akamaihd.net/client/installer/${build.file}`;
        const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
        const bytes = await res.arrayBuffer();
        downloads[key] = { sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"), size: bytes.byteLength };
    }
    return buildSteamcmdRecord(downloads);
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    let built: { key: string; record?: PackageRecord; error?: string };
    try {
        built = { key: "steamcmd", record: await buildLatestSteamcmdRecord() };
    } catch (err) {
        built = { key: "steamcmd", error: err instanceof Error ? err.message : String(err) };
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
