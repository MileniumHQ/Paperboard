import type { ServerSoftwareType } from "../software/catalog";

// Modrinth modpacks (.mrpack) as the Modpacks tab installs them: the
// pack's index names files to download by hash, and `overrides/` plus
// `server-overrides/` in the archive hold files copied in as they are.
// Everything here is pure: the index and every path in it are checked
// before the service downloads or writes a byte.
// Format: https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack

export const MODPACK_RECORD_KEY = "modpack";
/**
 * The staging folder of the last pack install or removal that was recorded.
 * Kept apart from the record: a removal records no pack, and its staging
 * folder must still be committed, not rolled back, after a crash.
 */
export const MODPACK_STAGING_KEY = "modpackStaging";
export const INDEX_ENTRY = "modrinth.index.json";
/** applied in this order: server-overrides win over overrides, which win over downloads */
export const OVERRIDE_DIRS = ["overrides/", "server-overrides/"] as const;

/** the .mrpack archive itself */
export const MAX_MRPACK_BYTES = 256 * 1024 * 1024;
export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
/** files a pack may place, downloads and overrides together */
export const MAX_PACK_FILES = 5000;
/** every download the index names, by its declared size */
export const MAX_PACK_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
/** everything extracted from overrides, as decompressed */
export const MAX_OVERRIDE_BYTES = 512 * 1024 * 1024;
export const MAX_OVERRIDE_FILE_BYTES = 64 * 1024 * 1024;

/** The modpack loaders each software runs, by their mrpack dependency key. */
export const MODPACK_LOADER: Partial<Record<ServerSoftwareType, { dependency: string; modrinth: string }>> = {
    fabric: { dependency: "fabric-loader", modrinth: "fabric" },
    neoforge: { dependency: "neoforge", modrinth: "neoforge" },
    forge: { dependency: "forge", modrinth: "forge" },
};

const LOADER_DEPENDENCIES = ["fabric-loader", "quilt-loader", "neoforge", "forge"];

/** Hosts the format allows downloads from; anything else is refused. */
const DOWNLOAD_HOSTS = new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]);

// The user's server that a pack may never write: worlds, settings, player
// lists, the installed software. Compared lowercased against the first
// path segment (or the whole path for files at the top).
const KEPT_TOP_LEVEL = new Set([
    "world",
    "world_nether",
    "world_the_end",
    "server.properties",
    "eula.txt",
    "ops.json",
    "whitelist.json",
    "banned-players.json",
    "banned-ips.json",
    "usercache.json",
    "logs",
    "crash-reports",
    "libraries",
    "versions",
    "server.jar",
    "run.sh",
    "run.bat",
    "user_jvm_args.txt",
]);

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const FORBIDDEN_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const MAX_SEGMENT = 255;
const MAX_PATH = 512;
const MAX_DEPTH = 16;

/**
 * A pack file path, `/`-separated and relative to the server folder, that
 * is safe to write on every OS the daemon runs on. Returns null for
 * anything else: traversal, absolute paths, characters Windows refuses,
 * reserved device names, names Windows would silently trim.
 */
export function safePackPath(raw: unknown): string | null {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PATH) return null;
    const segments = raw.split("/");
    if (segments.length > MAX_DEPTH) return null;
    for (const segment of segments) {
        if (segment === "" || segment === "." || segment === "..") return null;
        if (segment.length > MAX_SEGMENT || FORBIDDEN_CHARS.test(segment)) return null;
        if (WINDOWS_RESERVED.test(segment)) return null;
        // Windows drops trailing dots and spaces: "mods." would land on "mods"
        if (segment.endsWith(".") || segment.endsWith(" ")) return null;
    }
    return raw;
}

/**
 * Paths a pack may name but Paperboard does not let it write: the world,
 * the server's settings and the installed software. `levelName` is
 * server.properties' world, which may not be called "world".
 */
export function isKeptPath(path: string, levelName: string): boolean {
    const top = path.split("/")[0]!.toLowerCase();
    if (top.startsWith(".")) return true; // .install-*, .trash-*, .modpack-*, .fabric
    if (KEPT_TOP_LEVEL.has(top)) return true;
    const world = levelName.toLowerCase();
    return top === world || top === `${world}_nether` || top === `${world}_the_end`;
}

/** Lowercased: two pack paths differing only in case are one file on Windows and macOS. */
export function packPathKey(path: string): string {
    return path.toLowerCase();
}

export interface PackDownload {
    path: string;
    url: string;
    sha1: string;
    sha512: string;
    size: number;
}

export interface PackIndex {
    name: string;
    versionId: string;
    mcVersion: string;
    loaderVersion: string;
    downloads: PackDownload[];
    /** paths the pack names that Paperboard keeps as they are */
    kept: string[];
}

function fail(reason: string): never {
    throw new Error(`This modpack cannot be installed: ${reason}`);
}

function pickUrl(raw: unknown): string | null {
    if (!Array.isArray(raw)) return null;
    for (const url of raw) {
        if (typeof url !== "string" || !URL.canParse(url)) continue;
        const parsed = new URL(url);
        if (parsed.protocol === "https:" && DOWNLOAD_HOSTS.has(parsed.hostname)) return url;
    }
    return null;
}

/**
 * Checks a pack index against the server it is for. The pack must be for
 * the software's own loader (a Fabric pack does not run on NeoForge), name
 * its Minecraft and loader versions, and give every server file a safe
 * path, both Modrinth hashes and an allowed https download.
 */
export function parsePackIndex(raw: unknown, software: ServerSoftwareType, levelName: string): PackIndex {
    const loader = MODPACK_LOADER[software];
    if (!loader) fail(`${software} does not run modpacks`);
    if (typeof raw !== "object" || raw === null) fail("its index is not an object");
    const index = raw as Record<string, unknown>;
    if (index.formatVersion !== 1) fail(`index format ${JSON.stringify(index.formatVersion)} is not supported`);
    if (index.game !== "minecraft") fail("it is not a Minecraft pack");
    const deps = index.dependencies;
    if (typeof deps !== "object" || deps === null) fail("it names no dependencies");
    const dependencies = deps as Record<string, unknown>;
    const mcVersion = dependencies.minecraft;
    if (typeof mcVersion !== "string" || !/^[A-Za-z0-9._+-]{1,64}$/.test(mcVersion)) {
        fail("it names no Minecraft version");
    }
    const others = LOADER_DEPENDENCIES.filter((key) => key !== loader.dependency && dependencies[key] !== undefined);
    if (others.length > 0) fail(`it is built for ${others.join(", ")}, not this server's loader`);
    const loaderVersion = dependencies[loader.dependency];
    if (typeof loaderVersion !== "string" || !/^[A-Za-z0-9._+-]{1,64}$/.test(loaderVersion)) {
        fail(`it names no ${loader.dependency} version`);
    }

    const files = index.files;
    if (!Array.isArray(files)) fail("its file list is missing");
    if (files.length > MAX_PACK_FILES) fail(`it lists ${files.length} files, over the ${MAX_PACK_FILES} limit`);

    const downloads: PackDownload[] = [];
    const kept: string[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const entry of files as Record<string, unknown>[]) {
        const env = entry?.env as Record<string, unknown> | undefined;
        if (env && env.server === "unsupported") continue;
        const path = safePackPath(entry?.path);
        if (!path) fail(`it lists an unsafe file path ${JSON.stringify(entry?.path)}`);
        if (isKeptPath(path, levelName)) {
            kept.push(path);
            continue;
        }
        const key = packPathKey(path);
        if (seen.has(key)) fail(`it lists ${path} twice`);
        seen.add(key);
        const hashes = entry.hashes as Record<string, unknown> | undefined;
        const sha1 = hashes?.sha1;
        const sha512 = hashes?.sha512;
        if (typeof sha1 !== "string" || !/^[0-9a-f]{40}$/i.test(sha1)) fail(`${path} has no sha1`);
        if (typeof sha512 !== "string" || !/^[0-9a-f]{128}$/i.test(sha512)) fail(`${path} has no sha512`);
        const url = pickUrl(entry.downloads);
        if (!url) fail(`${path} has no download from an allowed host`);
        const size = entry.fileSize;
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) fail(`${path} has no file size`);
        total += size;
        if (total > MAX_PACK_DOWNLOAD_BYTES) fail("its downloads are over the 4 GiB limit");
        downloads.push({ path, url, sha1: sha1.toLowerCase(), sha512: sha512.toLowerCase(), size });
    }

    return {
        name: typeof index.name === "string" ? index.name : "",
        versionId: typeof index.versionId === "string" ? index.versionId : "",
        mcVersion,
        loaderVersion,
        downloads,
        kept,
    };
}

/**
 * Where an archive entry lands, or why it does not: "skip" for the index,
 * folders and anything outside the override folders; "kept" for a path the
 * user's server keeps; "unsafe" refuses the whole pack.
 */
export function overrideTarget(
    entryName: string,
    levelName: string,
):
    | { kind: "file"; path: string }
    | { kind: "kept"; path: string }
    | { kind: "skip" }
    | { kind: "unsafe"; reason: string } {
    const dir = OVERRIDE_DIRS.find((prefix) => entryName.startsWith(prefix));
    if (!dir || entryName.endsWith("/")) return { kind: "skip" };
    const path = safePackPath(entryName.slice(dir.length));
    if (!path) {
        return { kind: "unsafe", reason: `This modpack cannot be installed: it carries an unsafe override path ${JSON.stringify(entryName)}` };
    }
    return isKeptPath(path, levelName) ? { kind: "kept", path } : { kind: "file", path };
}

export interface ModpackRecord {
    projectId: string;
    versionId: string;
    slug: string;
    title: string;
    versionNumber: string;
    iconUrl?: string;
    mcVersion: string;
    loaderVersion: string;
    /** every path the pack placed; update and remove touch only these */
    files: string[];
}

/** Null when absent; throws when present but unreadable, so it is never overwritten as empty. */
export function parseModpackRecord(raw: unknown): ModpackRecord | null {
    if (raw === undefined || raw === null) return null;
    const rec = raw as Record<string, unknown>;
    const str = (key: string) => typeof rec[key] === "string";
    if (
        typeof raw !== "object" ||
        !["projectId", "versionId", "slug", "title", "versionNumber", "mcVersion", "loaderVersion"].every(str) ||
        (rec.iconUrl !== undefined && typeof rec.iconUrl !== "string") ||
        !Array.isArray(rec.files) ||
        !rec.files.every((path) => safePackPath(path) !== null)
    ) {
        throw new Error("The recorded modpack is unreadable; use Forget on the Modpacks tab (its files stay) before installing another");
    }
    return rec as unknown as ModpackRecord;
}
