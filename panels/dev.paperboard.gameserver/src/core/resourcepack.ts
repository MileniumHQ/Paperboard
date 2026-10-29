import type { ModrinthFile, ModrinthVersion } from "./modrinth";

// The server resource pack: server.properties holds the pack's URL and
// sha1; clients download it from there. The Resource Pack tab picks a
// Modrinth build (whose URL and sha1 Modrinth publishes) or hashes a pasted
// direct URL, and keeps one display record of what it picked so the tab can
// show a name and icon, not a bare URL.

export const RESOURCEPACK_SELECTION_KEY = "resourcePackSelection";
export const RESOURCEPACK_PROJECT_TYPE = "resourcepack";

/** the server rejects a pack larger than this (1.18+); older versions allow less */
export const RESOURCEPACK_MAX_BYTES = 250 * 1024 * 1024;

const MAX_URL_LENGTH = 2048;
const SHA1 = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResourcePackSelection {
    /** the URL written to `resource-pack`: the record only describes that URL */
    url: string;
    sha1: string;
    source: "modrinth" | "custom";
    projectId?: string;
    slug?: string;
    title?: string;
    version?: string;
    versionId?: string;
    iconUrl?: string;
}

export type ResourcePackProperties = Record<"resource-pack" | "resource-pack-sha1", string>;

/** A pack URL a client can download from: http(s), one line, nothing odd. */
export function assertResourcePackUrl(value: unknown): string {
    if (typeof value !== "string") throw new Error("Enter the resource pack's direct download URL");
    const url = value.trim();
    if (!url) throw new Error("Enter the resource pack's direct download URL");
    if (url.length > MAX_URL_LENGTH) throw new Error(`The URL is over ${MAX_URL_LENGTH} characters`);
    // a newline would end the line server.properties stores it on
    if (/[\s\u0000-\u001f\u007f]/.test(url)) throw new Error("The URL contains spaces or control characters");
    if (!URL.canParse(url)) throw new Error(`${url} is not a URL`);
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error(`Resource packs download over http or https, not ${parsed.protocol}`);
    }
    return url;
}

export function assertSha1(value: unknown): string {
    const sha1 = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!SHA1.test(sha1)) throw new Error(`${JSON.stringify(value)} is not a sha1 (40 hex digits)`);
    return sha1;
}

export function isResourcePackId(value: string): boolean {
    return value === "" || UUID.test(value);
}

/** The two keys that make a pack, or both blank to remove it. */
export function resourcePackProperties(selection: Pick<ResourcePackSelection, "url" | "sha1"> | null): ResourcePackProperties {
    if (!selection) return { "resource-pack": "", "resource-pack-sha1": "" };
    return { "resource-pack": assertResourcePackUrl(selection.url), "resource-pack-sha1": assertSha1(selection.sha1) };
}

/**
 * The build to select for a Minecraft version: the requested version when
 * given, else the newest. Either way it must list this exact Minecraft
 * version and carry a verifiable .zip, so what is written to
 * server.properties is a URL and hash Modrinth itself published.
 */
export function pickResourcePackBuild(
    versions: readonly ModrinthVersion[],
    mcVersion: string,
    versionId?: string,
): { version: ModrinthVersion; file: ModrinthFile } {
    const candidates = versionId ? versions.filter((v) => v.id === versionId) : versions;
    if (versionId && candidates.length === 0) {
        throw new Error("That resource pack version is not available for this server");
    }
    for (const version of candidates) {
        if (!version.gameVersions.includes(mcVersion)) continue;
        const file = version.primary;
        if (!file || !file.filename.toLowerCase().endsWith(".zip")) continue;
        return { version, file };
    }
    throw new Error(`This resource pack has no build for Minecraft ${mcVersion}`);
}

function isSelection(value: unknown): value is ResourcePackSelection {
    if (typeof value !== "object" || value === null) return false;
    const rec = value as Record<string, unknown>;
    const optional = (key: string) => rec[key] === undefined || typeof rec[key] === "string";
    return (
        typeof rec.url === "string" &&
        typeof rec.sha1 === "string" &&
        (rec.source === "modrinth" || rec.source === "custom") &&
        ["projectId", "slug", "title", "version", "versionId", "iconUrl"].every(optional)
    );
}

/** The saved record, or null when there is none. A record that does not parse is only memory of a name and icon, so it reads as absent. */
export function parseResourcePackSelection(raw: unknown): ResourcePackSelection | null {
    return isSelection(raw) ? raw : null;
}

/** The record describes the pack only while server.properties still points at its URL. */
export function selectionFor(
    selection: ResourcePackSelection | null,
    properties: Record<string, string>,
): ResourcePackSelection | null {
    return selection && selection.url === properties["resource-pack"] ? selection : null;
}

/**
 * `resource-pack-prompt` is a JSON text component. The tab takes plain
 * text and stores it as a JSON string; input that already is a component
 * (starts with `{`, `[` or `"`) is stored as written once it parses.
 */
export function promptToProperty(input: string): string {
    const text = input.trim();
    if (!text) return "";
    if (/^[{["]/.test(text)) {
        try {
            JSON.parse(text);
        } catch {
            throw new Error("That looks like a JSON text component but is not valid JSON");
        }
        return text;
    }
    return JSON.stringify(text);
}

/** The inverse of promptToProperty for display: a plain JSON string shows as its text. */
export function promptFromProperty(stored: string): string {
    if (!stored.startsWith('"')) return stored;
    try {
        const parsed: unknown = JSON.parse(stored);
        return typeof parsed === "string" ? parsed : stored;
    } catch (err) {
        // not a JSON string after all: show the value as the file holds it
        console.debug("[Resource Pack] prompt is not a JSON string:", err);
        return stored;
    }
}
