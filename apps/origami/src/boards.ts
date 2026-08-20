export interface BoardRecord {
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

export interface BoardsEnv {
    PACKAGES: KVNamespace;
    BOARDS_BUCKET?: R2Bucket;
    AUTH_KEY?: string;
}

const BOARD_KEY_PREFIX = "board:";
const BOARDS_INDEX_KEY = "boards:index";

export async function getBoardsIndex(
    kv: KVNamespace,
): Promise<Record<string, BoardRecord>> {
    try {
        const cached = await kv.get<Record<string, BoardRecord>>(
            BOARDS_INDEX_KEY,
            { type: "json" },
        );
        if (cached && typeof cached === "object") {
            return cached;
        }
    } catch {}

    const index: Record<string, BoardRecord> = {};
    let cursor: string | undefined = undefined;

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
                    })) as BoardRecord | null;
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

    return index;
}

export async function getBoard(
    kv: KVNamespace,
    id: string,
): Promise<BoardRecord | null> {
    try {
        const record = await kv.get(`${BOARD_KEY_PREFIX}${id}`, {
            type: "json",
        });
        return (record as BoardRecord) || null;
    } catch {
        return null;
    }
}

export async function saveBoard(
    kv: KVNamespace,
    record: BoardRecord,
): Promise<void> {
    await kv.put(`${BOARD_KEY_PREFIX}${record.id}`, JSON.stringify(record));

    const index = await getBoardsIndex(kv);
    index[record.id] = record;
    await kv.put(BOARDS_INDEX_KEY, JSON.stringify(index));
}

export async function deleteBoard(
    kv: KVNamespace,
    bucket: R2Bucket | undefined,
    id: string,
): Promise<boolean> {
    const existing = await getBoard(kv, id);
    if (!existing) return false;

    if (bucket && existing.archiveKey) {
        try {
            await bucket.delete(existing.archiveKey);
        } catch {}
    }

    await kv.delete(`${BOARD_KEY_PREFIX}${id}`);

    const index = await getBoardsIndex(kv);
    delete index[id];
    await kv.put(BOARDS_INDEX_KEY, JSON.stringify(index));

    return true;
}
