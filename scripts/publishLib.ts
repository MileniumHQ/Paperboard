// publishLib: pure release-math for the Paperboard publisher.
//
// Tags, canonical asset names, download URLs, latest.yml feeds, and the
// KV version records behind i.paperboard.dev. No prompts, no child
// processes, no network — everything here is unit-tested
// (publishLib.test.ts) and the interactive publish.ts is a thin shell
// around it.
//
// URL-shape constants are duplicated in apps/origami/src/routes/paperdl.ts
// (the worker cannot import scripts). The two sides must stay in sync:
// VERSION_SEGMENT, FILE_SEGMENT, DL_HOST, kvKeyFor, and the /<app>/<file>
// redirect contract. If you change one side, change the other and say so.

import {
    parseStoreManifest,
    storeImageExtension,
    storeScreenshotField,
    STORE_IMAGE_TYPES,
    STORE_MAX_SCREENSHOT_BYTES,
} from "../packages/paperapi/src/storeListing";

export const GH_REPO = "MileniumHQ/Paperboard";
export const DL_HOST = "i.paperboard.dev";
export const ORIGAMI_HOST = "origami.ariapis.com";

// Deploy targets. PAPERDL_R2_BUCKET and KV_PACKAGES_BINDING must match
// apps/origami/wrangler.jsonc (bucket_name / binding); the tests below pin
// them so a rename on either side fails loudly instead of uploading into
// the void. R2 holds only small metadata (latest.yml feeds); binaries live
// on GitHub Releases and Origami only 302-redirects to them.
export const PAPERDL_R2_BUCKET = "paperboard-paperdl";
export const KV_PACKAGES_BINDING = "PACKAGES";

export type DlApp = "pb" | "crane";

export type Target =
    | "linux-x64"
    | "linux-arm64"
    | "macos-x64"
    | "macos-arm64"
    | "windows-x64";

// Every shipped target, including linux-arm64 (untested but non-negotiable).
export const ALL_TARGETS: Target[] = [
    "linux-x64",
    "linux-arm64",
    "macos-x64",
    "macos-arm64",
    "windows-x64",
];

export type Os = "macos" | "windows" | "linux";

export function osOf(t: Target): Os {
    return t.startsWith("macos")
        ? "macos"
        : t.startsWith("windows")
          ? "windows"
          : "linux";
}

export const BUN_TARGET_MAP: Record<Target, string> = {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "macos-x64": "bun-darwin-x64",
    "macos-arm64": "bun-darwin-arm64",
    "windows-x64": "bun-windows-x64",
};

// One repo hosts both release lines, so tags carry the app:
// pb-v3.0.0-alpha, crane-v3.0.0-alpha.
export function tagFor(app: DlApp, version: string): string {
    return `${app}-v${version}`;
}

// Canonical release-asset filename per app+target. Versionless on purpose:
// the version lives in the tag and the URL path, so links stay stable and
// the updater can address "latest" without knowing filenames.
//
// Crane ships as .tar.gz on macOS/Linux (tar preserves the Unix executable
// bit; zip extraction drops it) and .zip on Windows (which has no useful
// exec bit and where Explorer opens zips natively).
export function assetFileName(app: DlApp, target: Target): string {
    if (app === "crane") {
        return osOf(target) === "windows"
            ? `crane-${target}.zip`
            : `crane-${target}.tar.gz`;
    }
    switch (target) {
        case "linux-x64":
            return "paperboard-linux-x64.AppImage";
        case "linux-arm64":
            return "paperboard-linux-arm64.AppImage";
        case "macos-x64":
            return "paperboard-macos-x64.zip";
        case "macos-arm64":
            return "paperboard-macos-arm64.zip";
        case "windows-x64":
            return "paperboard-windows-x64-setup.exe";
    }
}

// Direct GitHub release-asset URL. publish.ts uploads here; Origami only
// ever 302-redirects here, it never proxies bytes.
export function releaseAssetUrl(
    app: DlApp,
    version: string,
    file: string,
): string {
    return `https://github.com/${GH_REPO}/releases/download/${tagFor(app, version)}/${file}`;
}

// Public download URL. versionOrLatest is a real version ("3.0.0-alpha")
// or the literal "latest", which Origami resolves from the KV record.
export function dlFileUrl(
    app: DlApp,
    versionOrLatest: string,
    file: string,
): string {
    return `https://${DL_HOST}/${app}/${versionOrLatest}/${file}`;
}

// URL-shape guards. A version or filename sits inside a URL path slot on
// both the worker and the redirect target, so neither may contain "/",
// whitespace, "%", "?", or "#". "latest" matches VERSION_SEGMENT on
// purpose — the router checks the alias before the versioned route.
export const VERSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+\-]{0,63}$/;
export const FILE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,127}$/;

export function isValidVersionSegment(v: string): boolean {
    return VERSION_SEGMENT.test(v);
}

export function isValidFileSegment(f: string): boolean {
    return FILE_SEGMENT.test(f);
}

// KV version database (PACKAGES namespace, "dl/" prefix): one record per
// app holding every published version plus the latest pointer. This is
// what makes /pb/<version>/<file> and /pb/latest/<file> both work.
export function kvKeyFor(app: DlApp): string {
    return `dl/${app}`;
}

export interface VersionFileEntry {
    file: string;
    sha256: string;
    sha512?: string;
    size: number;
}

export interface DlAppRecord {
    latest: string;
    versions: Record<string, { files: VersionFileEntry[] }>;
}

// Publishing a version records its files and moves the latest pointer to
// it. Previous versions are retained, never overwritten or pruned.
export function mergeVersionRecord(
    prev: DlAppRecord | null,
    version: string,
    files: VersionFileEntry[],
): DlAppRecord {
    const versions: Record<string, { files: VersionFileEntry[] }> = {
        ...(prev?.versions ?? {}),
    };
    versions[version] = { files };
    return { latest: version, versions };
}

// electron-updater feed (paperboard only): one feed per OS covering all
// architectures of that OS, so no feed clobbers another. File URLs point
// at the dl "latest" alias, which 302s to the current GitHub assets.
export interface YmlEntry {
    target: Target;
    file: string;
    sha512: string;
    size: number;
}

export function ymlKeyFor(os: Os): string {
    return os === "windows"
        ? "latest.yml"
        : os === "macos"
          ? "latest-mac.yml"
          : "latest-linux.yml";
}

export function r2YmlKey(os: Os): string {
    return `pb/${ymlKeyFor(os)}`;
}

export function buildLatestYml(
    os: Os,
    version: string,
    entries: YmlEntry[],
    releaseDate: string,
): { key: string; text: string } {
    const yamlLines = [`version: ${version}`, `files:`];
    for (const e of entries) {
        yamlLines.push(
            `  - url: ${dlFileUrl("pb", "latest", e.file)}`,
            `    sha512: ${e.sha512}`,
            `    size: ${e.size}`,
        );
    }
    const primary = entries[0];
    yamlLines.push(
        `path: ${dlFileUrl("pb", "latest", primary.file)}`,
        `sha512: ${primary.sha512}`,
        `releaseDate: '${releaseDate}'`,
    );
    return { key: r2YmlKey(os), text: yamlLines.join("\n") };
}

// Legacy /paperdl/<app>/<target>/download compatibility: maps an old
// target to the canonical file so existing installs keep updating through
// a 302 to the new scheme. Unknown targets return null (genuine 404).
export function legacyDownloadRedirect(
    app: "paperboard" | "crane",
    target: string,
): string | null {
    const seg: DlApp = app === "paperboard" ? "pb" : "crane";
    const t = (ALL_TARGETS as string[]).includes(target)
        ? (target as Target)
        : null;
    if (!t) return null;
    return dlFileUrl(seg, "latest", assetFileName(seg, t));
}

// A registry stores record URLs from its configured PANEL_BASE_URL, not
// from the request host (Host-header poisoning is refused at the worker).
// Publishing to a local dev server whose PANEL_BASE_URL still names the
// production origin bakes unreachable URLs into every record — the panel
// library then renders icons/downloads from the wrong host. Returns the
// stored origin when it disagrees with the registry the publish targeted.
export function storedRecordOrigin(
    publishBase: string,
    recordUrl: unknown,
): string | null {
    if (typeof recordUrl !== "string" || !recordUrl) return null;
    try {
        const expected = new URL(publishBase).origin;
        const stored = new URL(recordUrl).origin;
        return expected === stored ? null : stored;
    } catch (err) {
        console.debug(
            "storedRecordOrigin: unparseable URL, skipping comparison:",
            String(err),
        );
        return null;
    }
}

// The files a panel's store listing names, as publish-form parts. The
// manifest block is validated by the same parser Origami enforces, so a
// listing the registry would refuse fails here, before the upload. `read`
// resolves a manifest path against the panel root; a missing file throws.
export interface StoreUploadPart {
    field: string;
    fileName: string;
    type: string;
    bytes: Uint8Array;
}

export function storeUploadParts(
    rawStore: unknown,
    read: (relativePath: string) => Uint8Array,
): { about?: string; files: StoreUploadPart[] } {
    const store = parseStoreManifest(rawStore);
    if (!store) return { files: [] };
    const files: StoreUploadPart[] = [];
    for (const [index, shot] of store.screenshots.entries()) {
        for (const theme of ["light", "dark"] as const) {
            const file = shot[theme];
            if (!file) continue;
            const bytes = read(file);
            if (bytes.byteLength > STORE_MAX_SCREENSHOT_BYTES) {
                throw new Error(`${file} is over the ${STORE_MAX_SCREENSHOT_BYTES}-byte screenshot cap`);
            }
            files.push({
                field: storeScreenshotField(index, theme),
                fileName: file.split("/").pop()!,
                type: STORE_IMAGE_TYPES[storeImageExtension(file)!]!,
                bytes,
            });
        }
    }
    const about = store.about
        ? new TextDecoder().decode(read(store.about))
        : undefined;
    return { ...(about !== undefined ? { about } : {}), files };
}
