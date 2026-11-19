// publishLib: pure release-math for the Paperboard publisher.
//
// Tags, canonical asset names, download URLs, latest.yml feeds, and the
// KV version records behind i.paperboard.dev. No prompts, no child
// processes, no network — everything here is unit-tested
// (publishLib.test.ts) and the interactive publish.ts is a thin shell
// around it.
//
// The download URL shape (host, repo, path segments) is the worker's own
// (services/origami/src/downloadUrl.ts), imported rather than copied. kvKeyFor
// and the canonical asset names are mirrored by
// services/origami/src/routes/paperdl.ts: change both sides together.

import {
    parseStoreManifest,
    storeImageExtension,
    storeScreenshotField,
    STORE_IMAGE_TYPES,
    STORE_MAX_SCREENSHOT_BYTES,
} from "../../packages/paperapi/src/internal";
import { DOWNLOAD_HOST, FILE_SEGMENT, GH_REPO, VERSION_SEGMENT } from "../../services/origami/src/downloadUrl";

export { GH_REPO };
export const ORIGAMI_HOST = "origami.ariapis.com";

// Deploy targets. PAPERDL_R2_BUCKET and KV_PACKAGES_BINDING must match
// services/origami/wrangler.jsonc (bucket_name / binding); publishLib.test.ts
// pins them so a rename on either side fails loudly instead of uploading
// into the void. R2 holds only small metadata (latest.yml feeds, the crane
// index, SHA256SUMS); binaries live on GitHub Releases and Origami only
// 302-redirects to them.
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

export type Arch = "x64" | "arm64";

export function archOf(t: Target): Arch {
    return t.endsWith("arm64") ? "arm64" : "x64";
}

export const BUN_TARGET_MAP: Record<Target, string> = {
    "linux-x64": "bun-linux-x64",
    "linux-arm64": "bun-linux-arm64",
    "macos-x64": "bun-darwin-x64",
    "macos-arm64": "bun-darwin-arm64",
    "windows-x64": "bun-windows-x64",
};

// `bun build --compile` embeds the runtime of the Bun that runs it, so a
// release ships whatever Bun the publisher has installed. The root
// package.json `packageManager` pin is the version CI gates against; the
// publisher refuses to compile with any other. Returns the refusal message,
// or null when the running Bun is the pinned one.
export function bunPinMismatch(packageManager: unknown, running: string): string | null {
    const match =
        typeof packageManager === "string" ? /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager) : null;
    if (!match) return `package.json packageManager must pin an exact Bun (bun@x.y.z), got ${JSON.stringify(packageManager)}`;
    const pinned = match[1];
    if (running === pinned) return null;
    return `release binaries embed the running Bun: pinned bun@${pinned}, running bun@${running}. Install Bun ${pinned} before publishing.`;
}

// One repo, one release line: a version's tag is `v<version>` and its single
// GitHub release holds both the app and the server (crane) binaries. The app
// embeds its daemon, so a crane change always ships under a new app tag too.
export function tagFor(version: string): string {
    return `v${version}`;
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

// The one artifact a Paperboard build produces for a target. `buildFile` is
// what electron-builder writes into dist/ (it embeds the version); the
// versionless `releaseFile` is the canonical name on the GitHub release and
// the updater feed. macOS ships a ZIP: it is both the installer users
// extract and the automatic-update payload, with no DMG tooling needed.
export function paperboardArtifacts(target: Target, version: string): {
    buildFile: string;
    releaseFile: string;
} {
    const releaseFile = assetFileName("pb", target);
    const buildFile = osOf(target) === "macos"
        ? `paperboard-${version}-${archOf(target)}.zip`
        : target === "linux-x64"
          ? `paperboard-${version}-linux-x86_64.AppImage`
          : releaseFile.replace("paperboard-", `paperboard-${version}-`);
    return { buildFile, releaseFile };
}

// Linux distro packages built beside the AppImage in the same electron-builder
// pass. They are downloads only: a package manager owns the installed bytes,
// so they never appear in an updater feed (see isUpdatePayload).
export type LinuxPackage = "deb" | "rpm";
export const LINUX_PACKAGES: LinuxPackage[] = ["deb", "rpm"];

// electron-builder names a package's arch the way its format does: Debian
// says amd64 where RPM says x86_64.
const PACKAGE_BUILD_ARCH: Record<LinuxPackage, Record<Arch, string>> = {
    deb: { x64: "amd64", arm64: "arm64" },
    rpm: { x64: "x86_64", arm64: "aarch64" },
};

export function paperboardPackages(target: Target, version: string): {
    buildFile: string;
    releaseFile: string;
}[] {
    if (osOf(target) !== "linux") return [];
    const arch = archOf(target);
    return LINUX_PACKAGES.map((format) => ({
        buildFile: `paperboard-${version}-linux-${PACKAGE_BUILD_ARCH[format][arch]}.${format}`,
        releaseFile: `paperboard-${target}.${format}`,
    }));
}

// Whether a published Paperboard file is what the app updates itself with.
export function isUpdatePayload(file: string): boolean {
    return !LINUX_PACKAGES.some((format) => file.endsWith(`.${format}`));
}

// The files the download index records from a release. Distro packages are
// expected only on a release that ships them, so a release made before deb and
// rpm still re-indexes; a release with some of them is missing the rest.
export function expectedReleaseAssets(
    onRelease: ReadonlySet<string>,
    version: string,
): { app: DlApp; target: Target; file: string }[] {
    const packages = ALL_TARGETS.flatMap((target) =>
        paperboardPackages(target, version).map((pkg) => ({ app: "pb" as DlApp, target, file: pkg.releaseFile })),
    );
    const shipsPackages = packages.some((pkg) => onRelease.has(pkg.file));
    return [
        ...ALL_TARGETS.map((target) => ({ app: "pb" as DlApp, target, file: assetFileName("pb", target) })),
        ...(shipsPackages ? packages : []),
        ...ALL_TARGETS.map((target) => ({ app: "crane" as DlApp, target, file: assetFileName("crane", target) })),
    ];
}

// What building the Linux packages needs beyond electron-builder itself,
// named before a Linux build starts rather than after the AppImage is built.
export function missingLinuxPackageTools(which: (cmd: string) => string | null): string | null {
    return which("rpmbuild")
        ? null
        : "Building the Linux rpm needs rpmbuild: install rpm (Debian, Ubuntu), rpm-tools (Arch) or rpm-build (Fedora).";
}

// The app keys a release build carries (apps/paperboard/src/main/env.d.ts),
// from apps/paperboard/.env.local on a computer or the release workflow's
// secrets. A build without one would ship a feature that can't work, such as
// Google Drive backups with no client to sign in with.
export const APP_KEYS = ["MAIN_VITE_GOOGLE_CLIENT_ID", "MAIN_VITE_GOOGLE_CLIENT_SECRET"] as const;

// What a release build is missing of APP_KEYS, named before it starts.
export function missingAppKeys(env: Record<string, string | undefined>): string | null {
    const missing = APP_KEYS.filter((key) => !env[key]?.trim());
    return missing.length === 0
        ? null
        : `A release build needs ${missing.join(" and ")}: put ${missing.length === 1 ? "it" : "them"} in apps/paperboard/.env.local, or in the repository's Actions secrets for the release workflow.`;
}

// Public download URL. versionOrLatest is a real version ("3.0.0-alpha")
// or the literal "latest", which Origami resolves from the KV record.
export function dlFileUrl(
    app: DlApp,
    versionOrLatest: string,
    file: string,
): string {
    return `https://${DOWNLOAD_HOST}/${app}/${versionOrLatest}/${file}`;
}

// The host's crane update planner reads Origami's R2 crane/index.json (it
// cannot read the KV version record directly). One entry per platform/arch
// carrying the same signed facts the daemon verifies: version, sha256 and
// the offline release signature. Kept in sync with paperboard's
// updatePlan.ts reads (`craneDlIndex[platform-arch]`).
export interface CraneIndexEntry {
    version: string;
    sha256: string;
    downloadUrl: string;
    signature: string;
}

export function buildCraneIndex(
    version: string,
    files: { target: Target; file: string; sha256: string; signature: string }[],
): Record<string, CraneIndexEntry> {
    const index: Record<string, CraneIndexEntry> = {};
    for (const f of files) {
        index[f.target] = {
            version,
            sha256: f.sha256,
            downloadUrl: dlFileUrl("crane", version, f.file),
            signature: f.signature,
        };
    }
    return index;
}

// URL-shape guards: the worker's own (services/origami/src/downloadUrl.ts)
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
    // offline release-key signature (crane: over version + sha256); the
    // daemon refuses a self-update without a valid one
    signature?: string;
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

// One electron-updater feed per channel file the updater requests. macOS
// reads both architectures from latest-mac.yml, but Linux names the arch:
// an arm64 AppImage asks for latest-linux-arm64.yml, x64 for latest-linux.yml.
export type Feed = Os | "linux-arm64";

export function feedOf(t: Target): Feed {
    return t === "linux-arm64" ? "linux-arm64" : osOf(t);
}

export function ymlKeyFor(feed: Feed): string {
    return feed === "windows"
        ? "latest.yml"
        : feed === "macos"
          ? "latest-mac.yml"
          : feed === "linux-arm64"
            ? "latest-linux-arm64.yml"
            : "latest-linux.yml";
}

export function r2YmlKey(feed: Feed): string {
    return `pb/${ymlKeyFor(feed)}`;
}

export function buildLatestYml(
    feed: Feed,
    version: string,
    entries: YmlEntry[],
    releaseDate: string,
): { key: string; text: string } {
    if (!entries.length) throw new Error(`No update artifacts for ${feed}`);
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
    return { key: r2YmlKey(feed), text: yamlLines.join("\n") };
}

// The checksum list the install scripts read (packages/npx/
// install/): one "<sha256>  <file>" line per Paperboard download of the
// latest release, in the format sha256sum writes. Served from R2 at
// i.paperboard.dev/pb/SHA256SUMS beside the feeds; each file is at
// /pb/latest/<file>. services/origami/src/routes/paperdl.ts serves this key.
export const SHA256SUMS_KEY = "pb/SHA256SUMS";

export function buildSha256Sums(files: { file: string; sha256: string }[]): string {
    if (!files.length) throw new Error("No Paperboard downloads to list in SHA256SUMS");
    const seen = new Set<string>();
    const lines = [...files]
        .sort((a, b) => a.file.localeCompare(b.file))
        .map(({ file, sha256 }) => {
            if (!isValidFileSegment(file)) throw new Error(`Not a download file name: ${JSON.stringify(file)}`);
            if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${file}: not a lowercase sha256: ${sha256}`);
            if (seen.has(file)) throw new Error(`${file} is listed twice`);
            seen.add(file);
            return `${sha256}  ${file}`;
        });
    return `${lines.join("\n")}\n`;
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
