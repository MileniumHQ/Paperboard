// A head cache over one way of asking the service for a head. The service
// resolves and composites Mojang skins (the browser cannot: the profile
// endpoint sends no CORS headers). Heads are fetched once per player,
// de-duplicated, and returned as data URLs, so rendering a roster does not
// re-request anything already seen. The panel and its widget page each
// build one over their own bridge.
const MAX_HEADS = 512;
const NEGATIVE_TTL_MS = 60_000;

export interface HeadRequest {
    name: string;
    uuid?: string;
    size?: number;
}

export type HeadFetch = (request: HeadRequest) => Promise<string | null | undefined>;

export interface HeadLoader {
    /** The head if one is already cached and still valid, else undefined. */
    peekHead(name: string, uuid?: string): string | null | undefined;
    /** Resolve a layered head data URL, or null when none is available. */
    loadHead(request: HeadRequest): Promise<string | null>;
}

interface HeadEntry {
    value: string | null;
    at: number;
}

export function createHeadLoader(fetchHead: HeadFetch): HeadLoader {
    const heads = new Map<string, HeadEntry>();
    const inflight = new Map<string, Promise<string | null>>();
    const keyFor = (name: string, uuid?: string) => (uuid || name).toLowerCase();

    const remember = (key: string, value: string | null) => {
        heads.delete(key);
        heads.set(key, { value, at: Date.now() });
        while (heads.size > MAX_HEADS) {
            const oldest = heads.keys().next().value;
            if (oldest === undefined) break;
            heads.delete(oldest);
        }
    };

    const peekHead = (name: string, uuid?: string) => {
        const key = keyFor(name, uuid);
        const entry = heads.get(key);
        if (!entry) return undefined;
        if (entry.value === null && Date.now() - entry.at >= NEGATIVE_TTL_MS) {
            heads.delete(key);
            return undefined;
        }
        return entry.value;
    };

    const loadHead = (request: HeadRequest): Promise<string | null> => {
        const key = keyFor(request.name, request.uuid);
        const cached = peekHead(request.name, request.uuid);
        if (cached !== undefined) return Promise.resolve(cached);
        const existing = inflight.get(key);
        if (existing) return existing;

        const promise = fetchHead(request)
            .then((value) => {
                remember(key, value ?? null);
                return value ?? null;
            })
            .catch((err) => {
                // a missing head falls back to the generic icon; log so a
                // broken lookup is visible rather than silently absent
                console.warn(`[skins] head lookup failed for "${key}":`, String(err));
                remember(key, null);
                return null;
            })
            .finally(() => inflight.delete(key));

        inflight.set(key, promise);
        return promise;
    };

    return { peekHead, loadHead };
}
