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
    sizeBytes?: number;
    updatedAt?: string;
    trashedAt?: string;
    author?: string;
    homepage?: string;
    manifest?: Record<string, unknown>;
}

export interface PanelsEnv {
    PACKAGES: KVNamespace;
    PANELS_BUCKET?: R2Bucket;
    AUTH_KEY?: string;
}

const PANEL_KEY_PREFIX = "panel:";
const PANELS_INDEX_KEY = "panels:index";

// trash prefix for recoverable deletes (see trashPanel below)
const TRASH_KEY_PREFIX = "trash:";

// publisher-supplied id/version reach KV keys, R2 keys, and the
// Content-Disposition header on download. Unvalidated strings let
// `id: "s:index"` become KV key `panels:index` (index overwrite) and let
// quotes/control chars break the download header. One validator, both
// fields, enforced at the publish boundary — never at read time.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const VERSION_PATTERN = /^[a-zA-Z0-9._+-]+$/;

export function isValidPanelId(id: unknown): id is string {
    return typeof id === "string" && id.length >= 1 && id.length <= 128 &&
        ID_PATTERN.test(id);
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

export async function savePanel(
    kv: KVNamespace,
    record: PanelRecord,
): Promise<void> {
    await kv.put(`${PANEL_KEY_PREFIX}${record.id}`, JSON.stringify(record));

    // the index is REBUILT from the panel:* keys, not read-modify-written:
    // a get→mutate→put loses concurrent publishes (two writers race the
    // same cached index) and KV's eventual consistency can serve a stale
    // get even single-threaded. The record write above is the source of
    // truth; the walk below is bounded and makes the index a projection.
    const index = await rebuildPanelsIndex(kv);
    await kv.put(PANELS_INDEX_KEY, JSON.stringify(index));
}

// bounded walk over every live panel record; the authoritative index shape
async function rebuildPanelsIndex(
    kv: KVNamespace,
): Promise<Record<string, PanelRecord>> {
    const index: Record<string, PanelRecord> = {};
    await listRecordsByPrefix(kv, PANEL_KEY_PREFIX, index);
    return index;
}

// recoverable delete: the live keys are removed but the record survives
// under trash:<ts>:<id> and the archive (if any) is copied to a trash/
// prefix before the original is deleted. Destructive boundaries are
// recoverable — the old code destroyed archive + KV immediately.
export async function trashPanel(
    kv: KVNamespace,
    bucket: R2Bucket | undefined,
    id: string,
): Promise<boolean> {
    const existing = await getPanel(kv, id);
    if (!existing) return false;

    const stamp = Date.now();
    const trashed: PanelRecord = {
        ...existing,
        trashedAt: new Date(stamp).toISOString(),
    };
    await kv.put(
        `${TRASH_KEY_PREFIX}${stamp}:${id}`,
        JSON.stringify(trashed),
    );

    if (bucket && existing.archiveKey) {
        try {
            const object = await bucket.get(existing.archiveKey);
            if (object) {
                await bucket.put(`trash/${stamp}-${existing.archiveKey}`, object.body, {
                    httpMetadata: { contentType: "application/gzip" },
                    customMetadata: {
                        id,
                        trashedAt: trashed.trashedAt!,
                    },
                });
                await bucket.delete(existing.archiveKey);
            }
        } catch (err) {
            console.error(`[origami] archive trash failed for ${existing.archiveKey}:`, err);
        }
    }

    // O6: the icon goes with the panel. Leaving `panels/<id>/icon.*` in R2
    // served a taken-down panel's branding forever (the icon route serves
    // by key, with no record check). Every extension variant is trashed —
    // a republish with a different extension would otherwise be shadowed.
    if (bucket) {
        for (const ext of ["png", "svg", "webp"]) {
            try {
                const iconKey = `panels/${id}/icon.${ext}`;
                const icon = await bucket.get(iconKey);
                if (icon) {
                    await bucket.put(`trash/${stamp}-${iconKey}`, icon.body, {
                        httpMetadata: icon.httpMetadata,
                        customMetadata: {
                            id,
                            trashedAt: trashed.trashedAt!,
                        },
                    });
                    await bucket.delete(iconKey);
                }
            } catch (err) {
                console.error(`[origami] icon trash failed for panels/${id}/icon.${ext}:`, err);
            }
        }
    }

    await kv.delete(`${PANEL_KEY_PREFIX}${id}`);

    // same projection rule as savePanel: rebuild from live keys, never
    // read-modify-write the cached index
    const index = await rebuildPanelsIndex(kv);
    await kv.put(PANELS_INDEX_KEY, JSON.stringify(index));

    return true;
}

export async function deletePanel(
    kv: KVNamespace,
    bucket: R2Bucket | undefined,
    id: string,
): Promise<boolean> {
    return trashPanel(kv, bucket, id);
}
