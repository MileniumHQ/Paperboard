export interface PanelRecord {
    id: string;
    name: string;
    version: string;
    description?: string;
    icon?: string;
    iconUrl?: string;
    downloadUrl?: string;
    archiveKey?: string;
    sha256?: string;
    sizeBytes?: number;
    updatedAt?: string;
    author?: string;
    homepage?: string;
    manifest?: Record<string, unknown>;
}

export type BoardRecord = PanelRecord;

export interface PanelsEnv {
    PACKAGES: KVNamespace;
    PANELS_BUCKET?: R2Bucket;
    BOARDS_BUCKET?: R2Bucket;
    AUTH_KEY?: string;
}

export type BoardsEnv = PanelsEnv;

const PANEL_KEY_PREFIX = "panel:";
const PANELS_INDEX_KEY = "panels:index";
const BOARD_KEY_PREFIX = "board:";
const BOARDS_INDEX_KEY = "boards:index";

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
    } catch {}

    try {
        const cachedBoard = await kv.get<Record<string, PanelRecord>>(
            BOARDS_INDEX_KEY,
            { type: "json" },
        );
        if (cachedBoard && typeof cachedBoard === "object") {
            return cachedBoard;
        }
    } catch {}

    const index: Record<string, PanelRecord> = {};
    let cursor: string | undefined = undefined;

    do {
        const listResult: KVNamespaceListResult<unknown> = await kv.list({
            prefix: PANEL_KEY_PREFIX,
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
                } catch {
                    return null;
                }
            }),
        );

        for (const record of records) {
            if (record && record.id) {
                index[record.id] = record;
            }
        }

        cursor = listResult.list_complete ? undefined : listResult.cursor;
    } while (cursor);

    if (Object.keys(index).length === 0) {
        cursor = undefined;
        do {
            const listResult: KVNamespaceListResult<unknown> = await kv.list({
                prefix: BOARD_KEY_PREFIX,
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
                    } catch {
                        return null;
                    }
                }),
            );

            for (const record of records) {
                if (record && record.id) {
                    index[record.id] = record;
                }
            }

            cursor = listResult.list_complete ? undefined : listResult.cursor;
        } while (cursor);
    }

    return index;
}

export const getBoardsIndex = getPanelsIndex;

export async function getPanel(
    kv: KVNamespace,
    id: string,
): Promise<PanelRecord | null> {
    try {
        let record = await kv.get(`${PANEL_KEY_PREFIX}${id}`, {
            type: "json",
        });
        if (!record) {
            record = await kv.get(`${BOARD_KEY_PREFIX}${id}`, {
                type: "json",
            });
        }
        return (record as PanelRecord) || null;
    } catch {
        return null;
    }
}

export const getBoard = getPanel;

export async function savePanel(
    kv: KVNamespace,
    record: PanelRecord,
): Promise<void> {
    await kv.put(`${PANEL_KEY_PREFIX}${record.id}`, JSON.stringify(record));
    await kv.put(`${BOARD_KEY_PREFIX}${record.id}`, JSON.stringify(record));

    const index = await getPanelsIndex(kv);
    index[record.id] = record;
    await kv.put(PANELS_INDEX_KEY, JSON.stringify(index));
    await kv.put(BOARDS_INDEX_KEY, JSON.stringify(index));
}

export const saveBoard = savePanel;

export async function deletePanel(
    kv: KVNamespace,
    bucket: R2Bucket | undefined,
    id: string,
): Promise<boolean> {
    const existing = await getPanel(kv, id);
    if (!existing) return false;

    if (bucket && existing.archiveKey) {
        try {
            await bucket.delete(existing.archiveKey);
        } catch {}
    }

    await kv.delete(`${PANEL_KEY_PREFIX}${id}`);
    await kv.delete(`${BOARD_KEY_PREFIX}${id}`);

    const index = await getPanelsIndex(kv);
    delete index[id];
    await kv.put(PANELS_INDEX_KEY, JSON.stringify(index));
    await kv.put(BOARDS_INDEX_KEY, JSON.stringify(index));

    return true;
}

export const deleteBoard = deletePanel;
