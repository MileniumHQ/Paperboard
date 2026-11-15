// Direct panel publishing, authenticated as the operator through wrangler.
//
// There is no worker publish route and no registry key: a panel is written
// by the same Cloudflare session that writes package records. Trust is
// unchanged — the operator hashes the archive it uploads, stores the
// publisher's offline release signature, and clients verify that signature
// against the key they ship with. What is gone is the public HTTP endpoint
// and its long-lived shared secret.
//
// Writes go: R2 archive + icon + store media, then the `panel:<id>` KV
// record, then the `panels:index` projection. The operator is the sole
// writer, so the index is maintained by reading and upserting it (the
// worker's live mutators are gone); a missing/unreadable index refuses the
// publish rather than writing a partial projection.
//
// Unlisting takes a panel off the store (out of `panels:index`) and leaves
// its record and archive: installs that have it keep it, and stop getting
// updates. Publishing it again lists it again.
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import {
    iconKey,
    isValidPanelVersion,
    storeMediaPrefix,
    PANEL_KEY_PREFIX,
    PANELS_INDEX_KEY,
    type PanelRecord,
} from "../../src/panels";
import {
    parseStoreManifest,
    storeImageExtension,
    storeScreenshotField,
    STORE_IMAGE_TYPES,
    STORE_MAX_ABOUT_BYTES,
    STORE_MAX_SCREENSHOT_BYTES,
    type StoreListing,
} from "@mileniumhq/paperapi/storeListing";
import { kvGetArgs, kvListArgs, kvPut, ORIGAMI_DIR, runCommand, withTempFile, type CommandRunner } from "./wrangler";

export const PANELS_BUCKET = "paperboard-boards";
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_ICON_BYTES = 1 * 1024 * 1024;

const ICON_CONTENT_TYPES: Record<string, string> = {
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
};

export class PanelPublishError extends Error {}

export function r2PutArgs(
    key: string,
    file: string,
    contentType: string,
    cacheControl?: string,
): string[] {
    const args = [
        "wrangler",
        "r2",
        "object",
        "put",
        `${PANELS_BUCKET}/${key}`,
        "--file",
        file,
        "--content-type",
        contentType,
        "--remote",
    ];
    if (cacheControl) args.push("--cache-control", cacheControl);
    return args;
}

// The registry store the publisher writes through. One interface, two
// implementations: wrangler in production, in-memory in tests. The publish
// logic is identical either way.
export interface PanelStorage {
    getJson<T>(key: string): Promise<T | null>;
    putJson(key: string, value: unknown): Promise<void>;
    putObject(
        key: string,
        bytes: Uint8Array,
        contentType: string,
        cacheControl?: string,
    ): Promise<void>;
}

export function createWranglerStorage(run: CommandRunner = runCommand): PanelStorage {
    return {
        async getJson<T>(key: string): Promise<T | null> {
            // list-then-get, exactly like the binary publisher: a missing
            // key is a legitimate null, an unreadable one must throw rather
            // than read as "nothing there". Never trust `kv key get`'s exit
            // code to tell them apart.
            const listed = (await run("bunx", kvListArgs(key), ORIGAMI_DIR)).stdout.trim();
            if (!listed || listed === "[]") return null;
            let names: { name: string }[];
            try {
                names = JSON.parse(listed);
            } catch {
                throw new PanelPublishError(`could not parse KV key list for ${key}`);
            }
            if (!Array.isArray(names) || !names.some((k) => k?.name === key)) return null;
            const raw = (await run("bunx", kvGetArgs(key), ORIGAMI_DIR)).stdout;
            try {
                return JSON.parse(raw) as T;
            } catch {
                throw new PanelPublishError(
                    `KV value ${key} is not valid JSON; refusing to overwrite it`,
                );
            }
        },
        async putJson(key: string, value: unknown): Promise<void> {
            await kvPut(run, key, JSON.stringify(value));
        },
        async putObject(
            key: string,
            bytes: Uint8Array,
            contentType: string,
            cacheControl?: string,
        ): Promise<void> {
            await withTempFile(bytes, (file) =>
                run("bunx", r2PutArgs(key, file, contentType, cacheControl), ORIGAMI_DIR),
            );
        },
    };
}

export interface StoreUpload {
    about?: string;
    /** raw screenshot parts, keyed by `storeScreenshotField(index, theme)` */
    files: Map<string, Uint8Array>;
}

export interface PanelUpload {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    /** offline release-key signature over (id, version, sha256) */
    signature: string;
    manifest?: Record<string, unknown>;
    icon?: { name: string; bytes: Uint8Array };
    store?: StoreUpload;
    archive: Uint8Array;
}

export interface PublishContext {
    storage: PanelStorage;
    /** canonical public origin baked into record URLs */
    origin: string;
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
    return crypto.subtle.digest("SHA-256", bytes).then((buf) =>
        Array.from(new Uint8Array(buf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
    );
}

function iconExtension(name: string): string | null {
    return name.endsWith(".svg")
        ? "svg"
        : name.endsWith(".webp")
          ? "webp"
          : name.endsWith(".png")
            ? "png"
            : null;
}

function assertInput(upload: PanelUpload): string | null {
    if (!upload.id || !upload.name || !upload.version) {
        return "metadata must include 'id', 'name', and 'version'";
    }
    if (!isPanelId(upload.id)) {
        return "invalid panel id: use a lowercase dotted identifier, at most 128 characters; library, settings and landing are reserved";
    }
    if (!isValidPanelVersion(upload.version)) {
        return "invalid panel version: use 1-64 characters of [a-zA-Z0-9._+-]";
    }
    if (
        typeof upload.signature !== "string" ||
        !/^[A-Za-z0-9+/]{40,200}={0,2}$/.test(upload.signature)
    ) {
        return "the upload must carry the release signature (sign with the Paperboard release key)";
    }
    if (upload.manifest?.id !== undefined && upload.manifest.id !== upload.id) {
        return "manifest id must match the published panel id";
    }
    if (upload.manifest?.unlisted !== undefined && typeof upload.manifest.unlisted !== "boolean") {
        return "manifest unlisted must be true or false";
    }
    if (upload.icon && !iconExtension(upload.icon.name)) {
        return `unsupported icon extension: '${upload.icon.name}' must be .png, .svg, or .webp`;
    }
    if (upload.icon && upload.icon.bytes.byteLength > MAX_ICON_BYTES) {
        return `icon exceeds the ${MAX_ICON_BYTES}-byte cap`;
    }
    if (upload.archive.byteLength > MAX_ARCHIVE_BYTES) {
        return `archive exceeds the ${MAX_ARCHIVE_BYTES}-byte cap`;
    }
    return null;
}

interface StoreMedia {
    listing: Omit<StoreListing, "screenshots">;
    screenshots: {
        alt?: string;
        files: { theme: "light" | "dark"; ext: string; bytes: Uint8Array }[];
    }[];
}

// Validates the whole listing before any bytes are written: a malformed
// listing must not leave a half-published release.
function readStoreUpload(upload: PanelUpload): StoreMedia | null {
    const manifest = parseStoreManifest(upload.manifest?.store);
    if (!manifest) return null;

    let about: string | undefined;
    if (manifest.about) {
        const text = upload.store?.about;
        if (typeof text !== "string" || !text.trim()) {
            throw new PanelPublishError(
                `about names ${manifest.about} but the upload has no about text`,
            );
        }
        if (new TextEncoder().encode(text).byteLength > STORE_MAX_ABOUT_BYTES) {
            throw new PanelPublishError(`about exceeds the ${STORE_MAX_ABOUT_BYTES}-byte cap`);
        }
        about = text;
    }

    const screenshots: StoreMedia["screenshots"] = [];
    for (const [index, shot] of manifest.screenshots.entries()) {
        const files: StoreMedia["screenshots"][number]["files"] = [];
        for (const theme of ["light", "dark"] as const) {
            const declared = shot[theme];
            if (!declared) continue;
            const field = storeScreenshotField(index, theme);
            const bytes = upload.store?.files.get(field);
            if (!bytes) {
                throw new PanelPublishError(
                    `screenshot ${declared} is missing from the upload (${field})`,
                );
            }
            if (bytes.byteLength > STORE_MAX_SCREENSHOT_BYTES) {
                throw new PanelPublishError(
                    `screenshot ${declared} exceeds the ${STORE_MAX_SCREENSHOT_BYTES}-byte cap`,
                );
            }
            files.push({ theme, ext: storeImageExtension(declared)!, bytes });
        }
        screenshots.push({ ...(shot.alt ? { alt: shot.alt } : {}), files });
    }

    return {
        listing: {
            ...(about ? { about } : {}),
            services: manifest.services,
            credits: manifest.credits,
            requirements: manifest.requirements,
        },
        screenshots,
    };
}

// The record names this release's icon, so a new extension or no icon at
// all replaces the old one instead of leaving it served.
async function uploadIcon(upload: PanelUpload, ctx: PublishContext): Promise<Pick<PanelRecord, "iconKey" | "iconUrl">> {
    if (!upload.icon) return {};
    const ext = iconExtension(upload.icon.name)!;
    const key = iconKey(upload.id, upload.version, ext);
    // content type derived from the extension, never the uploader's
    await ctx.storage.putObject(key, upload.icon.bytes, ICON_CONTENT_TYPES[ext]!, "public, max-age=31536000, immutable");
    return { iconKey: key, iconUrl: `${ctx.origin}/panel/${upload.id}/icon` };
}

// Media keys are per version: a republish never overwrites bytes an older
// record still references. Returns the listing with the registry's URLs.
async function uploadStoreMedia(upload: PanelUpload, media: StoreMedia, ctx: PublishContext): Promise<StoreListing> {
    const screenshots: StoreListing["screenshots"] = [];
    for (const [index, shot] of media.screenshots.entries()) {
        const urls: Partial<Record<"light" | "dark", string>> = {};
        for (const file of shot.files) {
            const name = `${index}-${file.theme}.${file.ext}`;
            await ctx.storage.putObject(
                `${storeMediaPrefix(upload.id)}${upload.version}/${name}`,
                file.bytes,
                STORE_IMAGE_TYPES[file.ext]!,
                "public, max-age=31536000, immutable",
            );
            urls[file.theme] = `${ctx.origin}/panel/${upload.id}/media/${upload.version}/${name}`;
        }
        screenshots.push({
            light: urls.light!,
            ...(urls.dark ? { dark: urls.dark } : {}),
            ...(shot.alt ? { alt: shot.alt } : {}),
        });
    }
    return { ...media.listing, screenshots };
}

/**
 * Publishes one panel and returns the stored record. Throws
 * `PanelPublishError` on any validation, version or I/O failure.
 *
 * KV has no transactions, so the guarantee is an order: bytes, then the
 * `panel:<id>` record, then `panels:index`. A failure before the record
 * leaves the registry as it was (bytes may be orphaned in R2, never
 * referenced). A failure writing the index leaves the new record live
 * (`/panel/:id.json` and downloads serve it) while the store still lists the
 * old release; the same version is then refused as already published, so
 * the repair is publishing the next version, which rewrites both.
 */
export async function publishPanel(
    upload: PanelUpload,
    ctx: PublishContext,
): Promise<PanelRecord> {
    const defect = assertInput(upload);
    if (defect) throw new PanelPublishError(defect);

    const { storage } = ctx;

    // a version names fixed bytes: a live record with this version refuses
    // the publish. The read is strict — an unreadable record refuses rather
    // than being overwritten.
    const existing = await storage.getJson<PanelRecord>(
        `${PANEL_KEY_PREFIX}${upload.id}`,
    );
    if (existing && existing.version === upload.version) {
        throw new PanelPublishError(
            `panel ${upload.id} version ${upload.version} is already published; bump the version to publish again`,
        );
    }

    // validate the full listing before writing anything
    const storeMedia = readStoreUpload(upload);

    const sha256 = await sha256Hex(upload.archive);
    const sizeBytes = upload.archive.byteLength;
    const archiveKey = `panels/${upload.id}/${upload.id}-${upload.version}.tar.gz`;
    await storage.putObject(archiveKey, upload.archive, "application/gzip");

    const icon = await uploadIcon(upload, ctx);
    const store = storeMedia ? await uploadStoreMedia(upload, storeMedia, ctx) : undefined;

    const record: PanelRecord = {
        id: upload.id,
        name: upload.name,
        version: upload.version,
        description: upload.description,
        ...icon,
        archiveKey,
        sha256,
        signature: upload.signature,
        sizeBytes,
        downloadUrl: `${ctx.origin}/panel/${upload.id}/download`,
        updatedAt: new Date().toISOString(),
        ...(upload.author ? { author: upload.author } : {}),
        ...(upload.homepage ? { homepage: upload.homepage } : {}),
        ...(store ? { store } : {}),
        ...(upload.manifest && typeof upload.manifest === "object"
            ? { manifest: upload.manifest }
            : {}),
        // "unlisted": true in the manifest keeps the panel off the store; the
        // record still carries each release to the installs that have it
        ...(upload.manifest?.unlisted === true
            ? { unlistedAt: existing?.unlistedAt ?? new Date().toISOString() }
            : {}),
    };

    // Panel bytes and media land first: the record (and index) only ever
    // reference objects that already exist.
    const index = await storage.getJson<Record<string, PanelRecord>>(PANELS_INDEX_KEY);
    if (!index || typeof index !== "object" || Array.isArray(index)) {
        throw new PanelPublishError(
            "panels:index is missing or unreadable; refusing to write a partial index",
        );
    }
    await storage.putJson(`${PANEL_KEY_PREFIX}${record.id}`, record);
    if (record.unlistedAt) delete index[record.id];
    else index[record.id] = record;
    await storage.putJson(PANELS_INDEX_KEY, index);

    return record;
}

/**
 * Take a panel off the store. Its record is marked and kept, its archive stays, and only the index loses it.
 * Refuses an id the registry has no record of, or one the store doesn't list.
 */
export async function unlistPanel(id: string, ctx: { storage: PanelStorage }): Promise<PanelRecord> {
    if (!isPanelId(id)) throw new PanelPublishError(`invalid panel id: ${JSON.stringify(id)}`);
    const { storage } = ctx;
    const record = await storage.getJson<PanelRecord>(`${PANEL_KEY_PREFIX}${id}`);
    if (!record) throw new PanelPublishError(`the registry has no panel ${id}`);
    const index = await storage.getJson<Record<string, PanelRecord>>(PANELS_INDEX_KEY);
    if (!index || typeof index !== "object" || Array.isArray(index)) {
        throw new PanelPublishError("panels:index is missing or unreadable; refusing to write a partial index");
    }
    if (!(id in index)) throw new PanelPublishError(`${id} isn't on the store`);
    // the record first: an index rebuilt from the records leaves it out from here on
    const unlisted: PanelRecord = { ...record, unlistedAt: new Date().toISOString() };
    await storage.putJson(`${PANEL_KEY_PREFIX}${id}`, unlisted);
    delete index[id];
    await storage.putJson(PANELS_INDEX_KEY, index);
    return unlisted;
}
