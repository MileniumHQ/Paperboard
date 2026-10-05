// Panel-side head cache. The service resolves and composites Mojang skins
// (the browser cannot: the profile endpoint sends no CORS headers). Heads are
// fetched once per player per session, de-duplicated, and returned as data
// URLs, so rendering a roster does not re-request anything already seen.
import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";

const MAX_HEADS = 512;
const NEGATIVE_TTL_MS = 60_000;

interface HeadEntry {
    value: string | null;
    at: number;
}

const heads = new Map<string, HeadEntry>();
const inflight = new Map<string, Promise<string | null>>();

function keyFor(name: string, uuid?: string): string {
    return (uuid || name).toLowerCase();
}

function remember(key: string, value: string | null): void {
    heads.set(key, { value, at: Date.now() });
    while (heads.size > MAX_HEADS) {
        const oldest = heads.keys().next().value;
        if (oldest === undefined) break;
        heads.delete(oldest);
    }
}

/** The head if one is already cached and still valid, else undefined. */
export function peekHead(name: string, uuid?: string): string | null | undefined {
    const entry = heads.get(keyFor(name, uuid));
    if (!entry) return undefined;
    if (entry.value === null && Date.now() - entry.at >= NEGATIVE_TTL_MS) {
        heads.delete(keyFor(name, uuid));
        return undefined;
    }
    return entry.value;
}

/** Resolve a layered head data URL, or null when none is available. */
export function loadHead(opts: { name: string; uuid?: string; size?: number }): Promise<string | null> {
    const key = keyFor(opts.name, opts.uuid);
    const cached = peekHead(opts.name, opts.uuid);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = serverBridge
        .call<string | null>(ACTION_IDS.getPlayerSkin, {
            player: opts.name,
            uuid: opts.uuid,
            size: opts.size,
        })
        .then((value) => {
            remember(key, value ?? null);
            return value ?? null;
        })
        .catch((err) => {
            // a missing head falls back to the generic icon; log so a broken
            // lookup is visible rather than silently absent
            console.warn(`[skins] head lookup failed for "${key}":`, String(err));
            remember(key, null);
            return null;
        })
        .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
}
