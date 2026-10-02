// Store listing: the optional `store` block of a panel manifest and the
// published form the registry serves to the panel library.
//
// One implementation for three callers: the publisher reads the manifest
// form and uploads the files it names, Origami validates the same form at
// the publish boundary and stores the published form, and the library
// parses the published form before rendering it. A listing is presentation
// only and grants nothing.
//
// Manifest form (paths are relative to the panel root, under store/):
//   "store": {
//     "about": "./store/about.md",
//     "screenshots": [{ "light": "./store/1-light.png", "dark": "./store/1-dark.png", "alt": "Chat" }],
//     "services": [{ "name": "Ollama", "detail": "Downloading models" }],
//     "credits": [{ "name": "Discord.js", "detail": "Providing the backend engine" }],
//     "requirements": [{ "name": "RAM", "detail": "16 GB" }]
//   }
//
// store/ is never packed into the install archive: screenshots are
// registry media, not something every install should carry.

export const STORE_MAX_SCREENSHOTS = 8;
export const STORE_MAX_ROWS = 12;
export const STORE_MAX_ABOUT_BYTES = 32 * 1024;
export const STORE_MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_ROW_NAME = 48;
const MAX_ROW_DETAIL = 160;
const MAX_ALT = 120;
const MAX_URL = 1024;

export const STORE_TABLES = ["services", "credits", "requirements"] as const;
export type StoreTable = (typeof STORE_TABLES)[number];

export const STORE_IMAGE_TYPES: Record<string, string> = {
    png: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
};

export interface StoreRow {
    name: string;
    detail: string;
}

export interface StoreScreenshot {
    light: string;
    dark?: string;
    alt?: string;
}

/** The manifest's `store` block: file paths, validated. */
export interface StoreManifest {
    about?: string;
    screenshots: StoreScreenshot[];
    services: StoreRow[];
    credits: StoreRow[];
    requirements: StoreRow[];
}

/** What the registry publishes: markdown text and hosted image URLs. */
export interface StoreListing {
    about?: string;
    screenshots: StoreScreenshot[];
    services: StoreRow[];
    credits: StoreRow[];
    requirements: StoreRow[];
}

const STORE_PATH = /^(?:\.\/)?store\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Lowercase image extension of a store path, or null when not an allowed image. */
export function storeImageExtension(file: string): string | null {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    return STORE_IMAGE_TYPES[ext] ? ext : null;
}

function storePath(v: unknown, field: string, image: boolean): string {
    if (typeof v !== "string" || !STORE_PATH.test(v) || v.split("/").includes("..")) {
        throw new Error(`store.${field} must be a relative path inside store/`);
    }
    if (image && !storeImageExtension(v)) {
        throw new Error(`store.${field} must be a .png, .webp or .jpg image`);
    }
    if (!image && !v.toLowerCase().endsWith(".md")) {
        throw new Error(`store.${field} must be a .md file`);
    }
    return v;
}

function text(v: unknown, max: number): string | null {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > max) return null;
    return trimmed;
}

function strictRows(raw: unknown, table: StoreTable): StoreRow[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new Error(`store.${table} must be an array`);
    if (raw.length > STORE_MAX_ROWS) {
        throw new Error(`store.${table} has more than ${STORE_MAX_ROWS} rows`);
    }
    return raw.map((row, i) => {
        const name = isObject(row) ? text(row.name, MAX_ROW_NAME) : null;
        const detail = isObject(row) ? text(row.detail, MAX_ROW_DETAIL) : null;
        if (!name || !detail) {
            throw new Error(
                `store.${table}[${i}] needs a name (max ${MAX_ROW_NAME}) and a detail (max ${MAX_ROW_DETAIL})`,
            );
        }
        return { name, detail };
    });
}

/**
 * Validates a manifest `store` block. Throws on anything malformed: a
 * listing is published once and read by every library visitor, so the
 * publish refuses rather than silently dropping rows. Absent means no
 * listing (null).
 */
export function parseStoreManifest(raw: unknown): StoreManifest | null {
    if (raw === undefined) return null;
    if (!isObject(raw)) throw new Error("store must be an object");

    const screenshotsRaw = raw.screenshots ?? [];
    if (!Array.isArray(screenshotsRaw)) throw new Error("store.screenshots must be an array");
    if (screenshotsRaw.length > STORE_MAX_SCREENSHOTS) {
        throw new Error(`store.screenshots has more than ${STORE_MAX_SCREENSHOTS} entries`);
    }
    const screenshots = screenshotsRaw.map((shot, i): StoreScreenshot => {
        if (!isObject(shot)) throw new Error(`store.screenshots[${i}] must be an object`);
        const out: StoreScreenshot = {
            light: storePath(shot.light, `screenshots[${i}].light`, true),
        };
        if (shot.dark !== undefined) {
            out.dark = storePath(shot.dark, `screenshots[${i}].dark`, true);
        }
        if (shot.alt !== undefined) {
            const alt = text(shot.alt, MAX_ALT);
            if (!alt) throw new Error(`store.screenshots[${i}].alt must be 1-${MAX_ALT} characters`);
            out.alt = alt;
        }
        return out;
    });

    const listing: StoreManifest = {
        screenshots,
        services: strictRows(raw.services, "services"),
        credits: strictRows(raw.credits, "credits"),
        requirements: strictRows(raw.requirements, "requirements"),
    };
    if (raw.about !== undefined) listing.about = storePath(raw.about, "about", false);
    return listing;
}

function lenientRows(raw: unknown): StoreRow[] {
    if (!Array.isArray(raw)) return [];
    const rows: StoreRow[] = [];
    for (const row of raw.slice(0, STORE_MAX_ROWS)) {
        if (!isObject(row)) continue;
        const name = text(row.name, MAX_ROW_NAME);
        const detail = text(row.detail, MAX_ROW_DETAIL);
        if (name && detail) rows.push({ name, detail });
    }
    return rows;
}

// An injected image: base64 raster bytes only. SVG is excluded because a
// data: SVG is a document, not a picture of one.
const DATA_IMAGE = /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_DATA_IMAGE = Math.ceil((STORE_MAX_SCREENSHOT_BYTES * 4) / 3) + 64;

export function isDataImage(v: unknown): v is string {
    return typeof v === "string" && v.length <= MAX_DATA_IMAGE && DATA_IMAGE.test(v);
}

function imageUrl(v: unknown, allowDataImages: boolean): string | null {
    if (allowDataImages && isDataImage(v)) return v;
    return httpUrl(v);
}

function httpUrl(v: unknown): string | null {
    if (typeof v !== "string" || v.length > MAX_URL) return null;
    // same-origin relative paths or absolute http(s); nothing else renders
    if (v.startsWith("/") && !v.startsWith("//")) return v;
    try {
        const url = new URL(v);
        return url.protocol === "https:" || url.protocol === "http:" ? v : null;
    } catch (err) {
        console.debug("[storeListing] dropping unparseable media URL:", String(err));
        return null;
    }
}

/**
 * Parses a published listing for rendering. The library holds no authority,
 * so it drops what it cannot render instead of failing the whole page.
 * Returns null when the record carries no listing at all.
 */
export function parseStoreListing(
    raw: unknown,
    options: { allowDataImages?: boolean } = {},
): StoreListing | null {
    const allowData = options.allowDataImages === true;
    if (!isObject(raw)) return null;
    const screenshots: StoreScreenshot[] = [];
    if (Array.isArray(raw.screenshots)) {
        for (const shot of raw.screenshots.slice(0, STORE_MAX_SCREENSHOTS)) {
            if (!isObject(shot)) continue;
            const light = imageUrl(shot.light, allowData);
            if (!light) continue;
            const out: StoreScreenshot = { light };
            const dark = imageUrl(shot.dark, allowData);
            if (dark) out.dark = dark;
            const alt = text(shot.alt, MAX_ALT);
            if (alt) out.alt = alt;
            screenshots.push(out);
        }
    }
    const listing: StoreListing = {
        screenshots,
        services: lenientRows(raw.services),
        credits: lenientRows(raw.credits),
        requirements: lenientRows(raw.requirements),
    };
    if (typeof raw.about === "string" && raw.about.trim()) {
        listing.about = raw.about.slice(0, STORE_MAX_ABOUT_BYTES);
    }
    return listing;
}

/** Multipart field name for one screenshot file at publish. */
export function storeScreenshotField(index: number, theme: "light" | "dark"): string {
    return `screenshot-${index}-${theme}`;
}

// ─── Installed-panel media ───────────────────────────────────────────────────
//
// A panel the registry does not list (a dev link, a direct install) still
// gets a library page: Paperboard reads its own manifest and store/ files
// and hands them to the library as data URLs, because the library's origin
// cannot address panel:// assets. `read` resolves a path inside the panel
// directory; the one shared parser above validates what it names.

export const INSTALLED_ICON_MAX_BYTES = 1024 * 1024;
const ICON_TYPES: Record<string, string> = {
    png: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
};

export interface InstalledPanelMedia {
    icon?: string;
    store?: StoreListing;
}

function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

async function readCapped(
    read: (path: string) => Promise<Uint8Array>,
    path: string,
    cap: number,
): Promise<Uint8Array> {
    const bytes = await read(path);
    if (bytes.byteLength > cap) throw new Error(`${path} is over the ${cap}-byte cap`);
    return bytes;
}

/**
 * Loads an installed panel's icon and (when `full`) its store listing.
 * A manifest that declares no listing yields just the icon. A listing that
 * is malformed or names a missing file rejects: the caller reports that
 * as unavailable instead of rendering half a page.
 */
export async function loadInstalledPanelMedia(
    read: (path: string) => Promise<Uint8Array>,
    full: boolean,
): Promise<InstalledPanelMedia> {
    const manifest = JSON.parse(new TextDecoder().decode(await read("manifest.json")));
    const media: InstalledPanelMedia = {};

    const iconPath = typeof manifest?.icon === "string" ? manifest.icon : null;
    const iconExt = iconPath?.split(".").pop()?.toLowerCase() ?? "";
    if (iconPath && ICON_TYPES[iconExt] && !iconPath.split(/[\\/]/).includes("..")) {
        const bytes = await readCapped(read, iconPath, INSTALLED_ICON_MAX_BYTES);
        media.icon = `data:${ICON_TYPES[iconExt]};base64,${toBase64(bytes)}`;
    }

    if (!full) return media;
    const store = parseStoreManifest(manifest?.store);
    if (!store) return media;

    const screenshots: StoreScreenshot[] = [];
    for (const shot of store.screenshots) {
        const out: Partial<StoreScreenshot> = {};
        for (const theme of ["light", "dark"] as const) {
            const file = shot[theme];
            if (!file) continue;
            const bytes = await readCapped(read, file, STORE_MAX_SCREENSHOT_BYTES);
            out[theme] = `data:${STORE_IMAGE_TYPES[storeImageExtension(file)!]};base64,${toBase64(bytes)}`;
        }
        screenshots.push({ ...(out as StoreScreenshot), ...(shot.alt ? { alt: shot.alt } : {}) });
    }
    media.store = {
        screenshots,
        services: store.services,
        credits: store.credits,
        requirements: store.requirements,
    };
    if (store.about) {
        const about = await readCapped(read, store.about, STORE_MAX_ABOUT_BYTES);
        media.store.about = new TextDecoder().decode(about);
    }
    return media;
}
