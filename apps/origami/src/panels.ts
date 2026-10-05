import { isPanelId } from "../../../packages/paperapi/src/panelIdentity";
import type { StoreListing } from "../../../packages/paperapi/src/storeListing";

export interface PanelRecord {
    id: string;
    name: string;
    version: string;
    description?: string;
    // O11: publisher-supplied icon URLs are refused at publish — icons are
    // hosted by the registry (iconUrl) or absent. The field is kept in the
    // type only because old deployed records may still carry it; new
    // records never write it.
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    archiveKey?: string;
    sha256?: string;
    // offline release-key signature over (id, version, sha256); clients
    // refuse a record without a valid one (papercrane/releaseSignature.ts)
    signature?: string;
    sizeBytes?: number;
    updatedAt?: string;
    trashedAt?: string;
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

export function isValidPanelId(id: unknown): id is string {
    return isPanelId(id);
}

export function isValidPanelVersion(version: unknown): version is string {
    return typeof version === "string" && version.length >= 1 &&
        version.length <= 64 && VERSION_PATTERN.test(version);
}

// prefix walks are bounded: an unbounded cursor loop turns registry growth
// into a Worker timeout. The index serves reads; the walk is the fallback.
const MAX_WALK_KEYS = 2000;

async function listRecordsByPrefix(
    kv: KVNamespace,
    prefix: string,
    index: Record<string, PanelRecord>,
): Promise<void> {
    let cursor: string | undefined = undefined;
    let walked = 0;

    do {
        const listResult: KVNamespaceListResult<unknown> = await kv.list({
            prefix,
            cursor,
        });

        const keys: string[] = listResult.keys.map(
            (k: { name: string }) => k.name,
        );
        const records = await Promise.all(
            keys.map(async (k: string) => {
                try {
                    return (await kv.get(k, {
                        type: "json",
                    })) as PanelRecord | null;
                } catch (err) {
                    console.error(`[origami] KV read failed for ${k}:`, err);
                    return null;
                }
            }),
        );

        for (const record of records) {
            if (walked >= MAX_WALK_KEYS) break;
            if (record && record.id) {
                index[record.id] = record;
                walked++;
            }
        }

        cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor && walked < MAX_WALK_KEYS);
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

export async function getPanel(
    kv: KVNamespace,
    id: string,
): Promise<PanelRecord | null> {
    try {
        const record = await kv.get(`${PANEL_KEY_PREFIX}${id}`, {
            type: "json",
        });
        return (record as PanelRecord) || null;
    } catch (err) {
        console.error(`[origami] panel read failed for ${id}:`, err);
        return null;
    }
}

// Media keys are shared by the write path (panelPublish.ts, operator-side)
// and the read route; one definition so they cannot drift.
export function storeMediaPrefix(panelId: string): string {
    return `panels/${panelId}/media/`;
}
