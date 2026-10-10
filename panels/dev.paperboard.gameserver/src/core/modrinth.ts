// Modrinth API records as the service reads them, and the pure checks
// every install from Modrinth makes on them. The service fetches version
// records itself: what gets installed is decided from Modrinth's answer,
// never from a file name or URL the panel page sends.

export const MODRINTH_API = "https://api.modrinth.com/v2";

export interface RawModrinthFile {
    url?: unknown;
    filename?: unknown;
    primary?: unknown;
    size?: unknown;
    hashes?: { sha1?: unknown; sha512?: unknown } | null;
}

export interface RawModrinthVersion {
    id?: unknown;
    project_id?: unknown;
    version_number?: unknown;
    name?: unknown;
    version_type?: unknown;
    loaders?: unknown;
    game_versions?: unknown;
    date_published?: unknown;
    files?: unknown;
}

export interface RawModrinthProject {
    id?: unknown;
    slug?: unknown;
    title?: unknown;
    icon_url?: unknown;
    project_type?: unknown;
}

export interface ModrinthFile {
    url: string;
    filename: string;
    size: number | null;
    sha1: string;
    sha512: string;
}

export interface ModrinthVersion {
    id: string;
    projectId: string;
    versionNumber: string;
    name: string;
    versionType: string;
    loaders: string[];
    gameVersions: string[];
    datePublished: string;
    files: ModrinthFile[];
    /** the file Modrinth marks primary, else the first; null when none is verifiable */
    primary: ModrinthFile | null;
}

export interface ModrinthProjectMeta {
    projectId: string;
    slug: string;
    title: string;
    iconUrl?: string;
    projectType: string;
}

/** Modrinth ids are base62, eight characters today; slugs are a superset. */
const ID_OR_SLUG = /^[A-Za-z0-9!@$()`.+,"\-']{1,64}$/;

export function assertModrinthId(value: unknown, label: string): string {
    if (typeof value !== "string" || !ID_OR_SLUG.test(value)) {
        throw new Error(`${label} is not a Modrinth id: ${JSON.stringify(value)}`);
    }
    return value;
}

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function parseFile(raw: RawModrinthFile): ModrinthFile | null {
    const sha1 = raw.hashes?.sha1;
    const sha512 = raw.hashes?.sha512;
    if (
        typeof raw.url !== "string" ||
        typeof raw.filename !== "string" ||
        typeof sha1 !== "string" ||
        !/^[0-9a-f]{40}$/i.test(sha1) ||
        typeof sha512 !== "string" ||
        !/^[0-9a-f]{128}$/i.test(sha512)
    ) {
        return null;
    }
    if (!URL.canParse(raw.url) || new URL(raw.url).protocol !== "https:") return null;
    return {
        url: raw.url,
        filename: raw.filename,
        size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : null,
        sha1: sha1.toLowerCase(),
        sha512: sha512.toLowerCase(),
    };
}

/**
 * A version record with its downloadable files. Files without both
 * Modrinth hashes or an https URL are dropped: nothing installs bytes it
 * cannot verify.
 */
export function parseModrinthVersion(raw: RawModrinthVersion): ModrinthVersion | null {
    if (typeof raw?.id !== "string" || typeof raw.project_id !== "string") return null;
    const rawFiles = Array.isArray(raw.files) ? (raw.files as RawModrinthFile[]) : [];
    const files: ModrinthFile[] = [];
    let primary: ModrinthFile | null = null;
    for (const entry of rawFiles) {
        const file = parseFile(entry ?? {});
        if (!file) continue;
        files.push(file);
        if (entry.primary === true && !primary) primary = file;
    }
    // a record whose primary file is unverifiable has no primary: the
    // first verifiable file is not what the author published as the build
    const markedPrimary = rawFiles.some((entry) => entry?.primary === true);
    if (!primary && !markedPrimary) primary = files[0] ?? null;
    return {
        id: raw.id,
        projectId: raw.project_id,
        versionNumber: typeof raw.version_number === "string" ? raw.version_number : "",
        name: typeof raw.name === "string" ? raw.name : "",
        versionType: typeof raw.version_type === "string" ? raw.version_type : "",
        loaders: strings(raw.loaders),
        gameVersions: strings(raw.game_versions),
        datePublished: typeof raw.date_published === "string" ? raw.date_published : "",
        files,
        primary,
    };
}

export function parseModrinthProject(raw: RawModrinthProject): ModrinthProjectMeta {
    if (typeof raw?.id !== "string" || typeof raw.slug !== "string" || typeof raw.title !== "string") {
        throw new Error("Modrinth returned an incomplete project");
    }
    return {
        projectId: raw.id,
        slug: raw.slug,
        title: raw.title,
        iconUrl: typeof raw.icon_url === "string" && raw.icon_url.startsWith("https://") ? raw.icon_url : undefined,
        projectType: typeof raw.project_type === "string" ? raw.project_type : "",
    };
}
