// Registry checksum resolution for ad-hoc package installs (bun-safe,
// node-safe: no electron imports). The update plan carries sha256 facts
// from planning time, but the package:download RPC path has no plan —
// callers like the gameserver Setup wizard just name a package. Rather
// than refuse a package the registry can verify, the daemon resolves the
// checksum itself from registry metadata and hands it to the engine,
// which re-reads the metadata and cross-checks (engine.ts). Two reads,
// one refusal posture: a failed lookup still throws instead of passing
// sha256: undefined.
import { resolveRegistryUrl } from "./util";
import { logger } from "./logger";
import { PAPERBOARD_USER_AGENT } from "./userAgent";

const REGISTRY_URL = resolveRegistryUrl();

const METADATA_TIMEOUT_MS = 10_000;
const METADATA_MAX_BYTES = 256 * 1024;
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
    const fetchFn = deps?.fetchFn ?? fetch;
    let res: Response;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), METADATA_TIMEOUT_MS);
        try {
            res = await fetchFn(url, {
                headers: { "User-Agent": PAPERBOARD_USER_AGENT },
                signal: ctrl.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    } catch (err) {
        throw new Error(
            `Install refused for package "${clean}": registry metadata unreachable (${err instanceof Error ? err.message : String(err)})`,
        );
    }
    if (!res.ok) {
        throw new Error(
            `Install refused for package "${clean}": registry has no metadata (HTTP ${res.status})`,
        );
    }
    let body: unknown;
    try {
        const text = await res.text();
        if (text.length > METADATA_MAX_BYTES) {
            throw new Error(`metadata exceeds ${METADATA_MAX_BYTES} bytes`);
        }
        body = JSON.parse(text);
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
