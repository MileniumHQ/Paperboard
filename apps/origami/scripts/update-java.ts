// Refreshes every java-<feature> record from Adoptium (Temurin JDKs).
//
//   bun run update:java              all available feature releases
//   bun run update:java -- 21 25     just these
//   bun run update:java -- --dry-run print, don't write
//
// Trust: the URL and sha256 both come from Adoptium's API record, fetched
// fresh over TLS on every run. Adoptium is the authority for its own
// artifacts; nothing publisher-supplied is persisted without it.
import { writeRecords, report } from "./lib/cli";
import {
    assertValidRecord,
    fetchJson,
    type PackageRecord,
    type PlatformDownload,
    type PlatformKey,
} from "./lib/records";

const API = "https://api.adoptium.net/v3";

export interface AdoptiumAsset {
    release_name?: string;
    version?: { openjdk_version?: string };
    binary?: {
        os?: string;
        architecture?: string;
        image_type?: string;
        jvm_impl?: string;
        heap_size?: string;
        package?: { link?: string; checksum?: string; size?: number };
    };
}

export function platformKeyForAdoptium(os: string, arch: string): PlatformKey | null {
    const o = os.toLowerCase();
    const a = arch.toLowerCase();
    const suffix = a === "x64" ? "x64" : a === "aarch64" || a === "arm64" ? "arm64" : null;
    if (!suffix) return null;
    if (o === "linux") return `linux-${suffix}`;
    if (o === "mac" || o === "macos") return `macos-${suffix}`;
    if (o === "windows") return `windows-${suffix}`;
    return null;
}

export function buildJavaRecord(feature: number, assets: AdoptiumAsset[]): PackageRecord {
    if (!Array.isArray(assets) || assets.length === 0) {
        throw new Error("Adoptium returned no assets");
    }
    const platforms: Partial<Record<PlatformKey, PlatformDownload>> = {};
    for (const asset of assets) {
        const bin = asset.binary;
        if (!bin?.os || !bin.architecture || !bin.package?.link) continue;
        if (bin.image_type && bin.image_type !== "jdk") continue;
        if (bin.jvm_impl && bin.jvm_impl !== "hotspot") continue;
        if (bin.heap_size && bin.heap_size !== "normal") continue;
        const key = platformKeyForAdoptium(bin.os, bin.architecture);
        if (!key || platforms[key]) continue;
        const sha256 = (bin.package.checksum ?? "").toLowerCase();
        // a platform without a checksum is uninstallable (the daemon refuses
        // it), so it is left out rather than published as a trap
        if (!/^[a-f0-9]{64}$/.test(sha256)) continue;
        platforms[key] = {
            url: bin.package.link,
            sha256,
            ...(typeof bin.package.size === "number" ? { size: bin.package.size } : {}),
        };
    }
    const first = assets[0]!;
    const version =
        first.release_name?.replace(/^jdk-?/, "") || first.version?.openjdk_version;
    if (!version) throw new Error("Adoptium asset has no version");
    const record: PackageRecord = { name: `java-${feature}`, version, platforms };
    assertValidRecord(record);
    return record;
}

export async function availableFeatures(fetchFn: typeof fetch = fetch): Promise<number[]> {
    const info = await fetchJson<{ available_releases?: unknown }>(
        `${API}/info/available_releases`,
        fetchFn,
    );
    const list = info.available_releases;
    if (!Array.isArray(list) || list.length === 0 || !list.every((n) => Number.isInteger(n))) {
        throw new Error("Adoptium available_releases is missing or malformed");
    }
    return list as number[];
}

export async function buildJavaRecords(
    features: number[],
    fetchFn: typeof fetch = fetch,
): Promise<{ key: string; record?: PackageRecord; error?: string }[]> {
    const built: { key: string; record?: PackageRecord; error?: string }[] = [];
    for (const feature of features) {
        const key = `java-${feature}`;
        try {
            const assets = await fetchJson<AdoptiumAsset[]>(
                `${API}/assets/latest/${feature}/hotspot?image_type=jdk`,
                fetchFn,
            );
            built.push({ key, record: buildJavaRecord(feature, assets) });
        } catch (err) {
            built.push({ key, error: err instanceof Error ? err.message : String(err) });
        }
    }
    return built;
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run");
    const explicit = argv.filter((a) => !a.startsWith("--")).map((a) => a.replace(/^java-?/, ""));
    for (const a of explicit) {
        if (!/^\d+$/.test(a)) throw new Error(`not a Java feature version: ${a}`);
    }
    const features = explicit.length > 0 ? explicit.map(Number) : await availableFeatures();
    const built = await buildJavaRecords(features);
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
