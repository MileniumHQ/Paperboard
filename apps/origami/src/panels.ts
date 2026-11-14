import { RegistryLimitError, UnreadableRecordError } from "./recordError";
import type { StoreListing } from "../../../packages/paperapi/src/storeListing";

export interface PanelRecord {
    id: string;
    name: string;
    version: string;
    description?: string;
    /**
     * the registry-hosted icon's address. Every record published now sets it
     * together with `iconKey`; older records set it alone, and the icon
     * route then serves the icon under the panel's legacy fixed key.
     */
    iconUrl?: string;
    /** the R2 object the icon route serves: only this release's icon, never an older one's */
    iconKey?: string;
    downloadUrl?: string;
    archiveKey?: string;
    sha256?: string;
    // offline release-key signature over (id, version, sha256); clients
    // refuse a record without a valid one (papercrane/releaseSignature.ts)
    signature?: string;
    sizeBytes?: number;
    updatedAt?: string;
    /** taken off the store: out of `panels:index`, but the record and its archive stay for the installs that have it */
    unlistedAt?: string;
    author?: string;
    homepage?: string;
    manifest?: Record<string, unknown>;
    /** published store listing: about text and registry-hosted screenshots */
    store?: StoreListing;
}

export const PANEL_KEY_PREFIX = "panel:";
export const PANELS_INDEX_KEY = "panels:index";

// publisher-supplied id/version reach KV keys, R2 keys, and the
// Content-Disposition header on download. Unvalidated strings let
// `id: "s:index"` become KV key `panels:index` (index overwrite) and let
// quotes/control chars break the download header. One validator, both
// fields, enforced at the publish boundary — never at read time.
const VERSION_PATTERN = /^[a-zA-Z0-9._+-]+$/;

export function isValidPanelVersion(version: unknown): version is string {
    return typeof version === "string" && version.length >= 1 &&
        version.length <= 64 && VERSION_PATTERN.test(version);
}

// The walk is the fallback when the index can't be read. It is bounded, so
// registry growth can't turn it into a Worker timeout, and past the bound it
// fails rather than answer a store that is missing panels.
const MAX_WALK_KEYS = 2000;

async function listRecordsByPrefix(
    kv: KVNamespace,
    prefix: string,
    index: Record<string, PanelRecord>,
): Promise<void> {
    let cursor: string | undefined;
    let walked = 0;
    do {
        const page: KVNamespaceListResult<unknown> = await kv.list({ prefix, cursor });
        walked += page.keys.length;
        if (walked > MAX_WALK_KEYS) {
            console.error(`[origami] the panels index walk passed ${MAX_WALK_KEYS} records`);
            throw new RegistryLimitError(`more than the ${MAX_WALK_KEYS} panels the store can list without its index`);
        }
        // an unreadable record fails the request, never drops out of it:
        // unavailable is not "unpublished"
        const records = await Promise.all(
            page.keys.map((k) => kv.get<PanelRecord>(k.name, { type: "json" })),
        );
        for (const record of records) {
            // an unlisted panel stays out of the store even when the index is rebuilt from the records
            if (record?.id && !record.unlistedAt) index[record.id] = record;
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
}

export async function getPanelsIndex(
    kv: KVNamespace,
): Promise<Record<string, PanelRecord>> {
    try {
        const cached = await kv.get<Record<string, PanelRecord>>(
            PANELS_INDEX_KEY,
            { type: "json" },
        );
        if (cached && typeof cached === "object") {
            return cached;
        }
    } catch (err) {
        console.error("[origami] panels index read failed, falling back:", err);
    }

    const index: Record<string, PanelRecord> = {};
    await listRecordsByPrefix(kv, PANEL_KEY_PREFIX, index);

    return index;
}

// null only when there is no record: a record that can't be read is not a
// panel that doesn't exist, and answering 404 for it would tell the updater
// the panel was never published
export async function getPanel(
    kv: KVNamespace,
    id: string,
): Promise<PanelRecord | null> {
    let record: unknown;
    try {
        record = await kv.get(`${PANEL_KEY_PREFIX}${id}`, { type: "json" });
    } catch (err) {
        console.error(`[origami] panel read failed for ${id}:`, err);
        throw new UnreadableRecordError(id);
    }
    if (record === null) return null;
    if (typeof record !== "object" || Array.isArray(record)) {
        console.error(`[origami] panel record for ${id} is not an object`);
        throw new UnreadableRecordError(id);
    }
    return record as PanelRecord;
}

// Media and icon keys are shared by the write path (panelPublish.ts,
// operator-side) and the read routes; one definition so they cannot drift.
export function storeMediaPrefix(panelId: string): string {
    return `panels/${panelId}/media/`;
}

// per release, like the media: a new release's icon never overwrites the
// one an older record still names
export function iconKey(panelId: string, version: string, ext: string): string {
    return `panels/${panelId}/icons/${version}.${ext}`;
}
