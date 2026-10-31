// Refreshes the .NET runtime packages (dotnet-<major>): Microsoft's own
// portable runtime archives, for game servers built on .NET (tModLoader).
// bun run update:dotnet -- --dry-run prints without writing.
// Trust: Microsoft's release metadata publishes a SHA-512 for every file.
// Every archive is downloaded and checked against it; the record carries
// the SHA-256 of the same verified bytes, which is what the daemon checks.
// A mismatch, a missing platform or an unexpected file fails the record.
import { createHash } from "node:crypto";
import { writeRecords, report } from "./lib/cli";
import { assertValidRecord, fetchJson, type PackageRecord, type PlatformDownload, type PlatformKey } from "./lib/records";

/** Channels Paperboard publishes. tModLoader pins 8.0 with roll-forward disabled. */
export const CHANNELS = ["8.0"] as const;

/** Microsoft runtime id for each package platform. Windows arm64 is left out: no consumer is certified there. */
export const RIDS: Partial<Record<PlatformKey, string>> = {
    "linux-x64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "macos-x64": "osx-x64",
    "macos-arm64": "osx-arm64",
    "windows-x64": "win-x64",
};

export interface DotnetFile {
    name: string;
    rid?: string;
    url: string;
    hash: string;
}

export interface DotnetReleases {
    "channel-version": string;
    "latest-runtime": string;
    releases: { "release-version": string; runtime?: { version: string; files: DotnetFile[] } }[];
}

/** The runtime files of the channel's latest runtime release, keyed by package platform. */
export function runtimeFiles(meta: DotnetReleases): { version: string; files: Partial<Record<PlatformKey, DotnetFile>> } {
    const version = meta["latest-runtime"];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`dotnet ${meta["channel-version"]}: unexpected latest runtime ${JSON.stringify(version)}`);
    const runtime = meta.releases.find((r) => r.runtime?.version === version)?.runtime;
    if (!runtime) throw new Error(`dotnet ${version}: no release lists this runtime`);
    const files: Partial<Record<PlatformKey, DotnetFile>> = {};
    for (const [key, rid] of Object.entries(RIDS) as [PlatformKey, string][]) {
        const ext = rid.startsWith("win-") ? "zip" : "tar.gz";
        const file = runtime.files.find((f) => f.rid === rid && f.name === `dotnet-runtime-${rid}.${ext}`);
        if (!file) throw new Error(`dotnet ${version}: no ${rid} runtime archive`);
        const url = new URL(file.url);
        if (url.protocol !== "https:" || url.hostname !== "builds.dotnet.microsoft.com" || !url.pathname.endsWith(`/dotnet-runtime-${version}-${rid}.${ext}`)) {
            throw new Error(`dotnet ${version}: unexpected ${rid} download ${file.url}`);
        }
        if (!/^[a-f0-9]{128}$/.test(file.hash)) throw new Error(`dotnet ${version}: ${rid} has no SHA-512`);
        files[key] = file;
    }
    return { version, files };
}

export function buildDotnetRecord(
    channel: string,
    version: string,
    files: Partial<Record<PlatformKey, DotnetFile>>,
    observed: Partial<Record<PlatformKey, { sha512: string; sha256: string; size: number }>>,
): PackageRecord {
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const [key, file] of Object.entries(files) as [PlatformKey, DotnetFile][]) {
        const seen = observed[key];
        if (!seen) throw new Error(`${file.name}: download missing`);
        if (seen.sha512 !== file.hash) throw new Error(`${file.name}: SHA-512 differs from Microsoft's release metadata`);
        const windows = key.startsWith("windows-");
        // the host finds host/fxr and shared/ beside itself, so all three stay together under bin/
        platforms[key] = {
            url: file.url,
            sha256: seen.sha256,
            size: seen.size,
            recipe: {
                unpack: windows ? "zip" : "tar",
                take: {
                    [windows ? "bin/dotnet.exe" : "bin/dotnet"]: windows ? "dotnet.exe" : "dotnet",
                    "bin/host": "host",
                    "bin/shared": "shared",
                    "LICENSE.txt": "LICENSE.txt",
                    "ThirdPartyNotices.txt": "ThirdPartyNotices.txt",
                },
            },
        };
    }
    const record: PackageRecord = { name: `dotnet-${channel.split(".")[0]}`, version, platforms };
    assertValidRecord(record);
    return record;
}

export async function buildLatestDotnetRecord(channel: string, fetchFn: typeof fetch = fetch): Promise<PackageRecord> {
    const meta = await fetchJson<DotnetReleases>(`https://builds.dotnet.microsoft.com/dotnet/release-metadata/${channel}/releases.json`, fetchFn);
    if (meta["channel-version"] !== channel) throw new Error(`dotnet ${channel}: metadata is for ${meta["channel-version"]}`);
    const { version, files } = runtimeFiles(meta);
    const observed: Partial<Record<PlatformKey, { sha512: string; sha256: string; size: number }>> = {};
    for (const [key, file] of Object.entries(files) as [PlatformKey, DotnetFile][]) {
        const res = await fetchFn(file.url, { signal: AbortSignal.timeout(300_000) });
        if (!res.ok) throw new Error(`GET ${file.url} failed: ${res.status} ${res.statusText}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        observed[key] = {
            sha512: createHash("sha512").update(bytes).digest("hex"),
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.byteLength,
        };
    }
    return buildDotnetRecord(channel, version, files, observed);
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    const built: { key: string; record?: PackageRecord; error?: string }[] = [];
    for (const channel of CHANNELS) {
        const key = `dotnet-${channel.split(".")[0]}`;
        try {
            built.push({ key, record: await buildLatestDotnetRecord(channel) });
        } catch (err) {
            built.push({ key, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return report(await writeRecords(built, { dryRun }), dryRun);
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
