// Registry checksum resolution for ad-hoc package installs (bun-safe,
// node-safe: no electron imports). The update plan carries sha256 facts
// from planning time, but the package:download RPC path has no plan —
// callers like the gameserver Setup wizard just name a package. The daemon
// reads the registry record once (bounded, shared reader) so it can hand
// the engine an expected digest; the engine then re-reads the record and
// verifies the release signature, which is the actual authority. The first
// read adds no authority, only the fact a plan would have supplied.
import { resolveRegistryUrl } from "./util";
import { logger } from "./logger";
import { fetchRegistryRecord } from "./registryRecord";

const REGISTRY_URL = resolveRegistryUrl();

const SHA256_RE = /^[a-f0-9]{64}$/i;

export interface PackageChecksumDeps {
    fetchFn?: typeof fetch;
    platform?: string;
    arch?: string;
}

// node platform/arch to registry platform keys (mirrors Origami's
// mapAdoptiumBinaryToPlatformKey from the consumer side)
export function platformKeyFor(platform: string, arch: string): string | null {
    const a = arch.toLowerCase();
    const arm = a === "arm64" || a === "aarch64";
    const x64 = a === "x64" || a === "amd64";
    if (!(arm || x64)) return null;
    const suffix = arm ? "arm64" : "x64";
    switch (platform.toLowerCase()) {
        case "linux":
            return `linux-${suffix}`;
        case "darwin":
        case "macos":
        case "mac":
            return `macos-${suffix}`;
        case "win32":
        case "windows":
            return `windows-${suffix}`;
        default:
            return null;
    }
}

export function validSha256(value: unknown): value is string {
    return typeof value === "string" && SHA256_RE.test(value);
}

export async function resolvePackageSha256(
    packageName: string,
    deps?: PackageChecksumDeps,
): Promise<string> {
    const clean = String(packageName ?? "").trim();
    if (!clean || clean.length > 128) {
        throw new Error(`Refusing checksum lookup for invalid package name: ${JSON.stringify(packageName)}`);
    }
    const key = platformKeyFor(deps?.platform ?? process.platform, deps?.arch ?? process.arch);
    if (!key) {
        throw new Error(
            `No registry package build for this platform (${process.platform}/${process.arch})`,
        );
    }
    const url = `${REGISTRY_URL}/package/${encodeURIComponent(clean)}.json`;
    let body: unknown;
    try {
        body = await fetchRegistryRecord(url, deps?.fetchFn);
    } catch (err) {
        throw new Error(
            `Install refused for package "${clean}": registry metadata unreadable (${err instanceof Error ? err.message : String(err)})`,
        );
    }
    const entry = (body as any)?.platforms?.[key];
    const sha256 = entry?.sha256;
    if (!validSha256(sha256)) {
        logger.warn(`[package-checksum] registry metadata for "${clean}" has no sha256 for ${key}`);
        throw new Error(
            `Install refused for package "${clean}": registry did not provide a sha256 checksum for ${key}`,
        );
    }
    return sha256.toLowerCase();
}
