// Player heads from Mojang. The profile and skin endpoints do not send CORS
// headers, so the browser cannot read them directly; the service fetches,
// composites the head (face + hat) and returns a data URL the panel can draw.
// Profiles and skins are immutable per UUID, so results are cached in-memory
// for the life of the service and lookups are de-duplicated and concurrency
// capped — a roster of a hundred players issues a bounded number of requests.
import { apiFetch } from "../lib/userAgent";
import { composeHeadFromSkin, clampHeadSize } from "../core/skin";
import { uuidForPlayerName } from "./playerStats";

const PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/";
const NAME_URL = "https://api.mojang.com/users/profiles/minecraft/";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CACHE = 512;
const MAX_CONCURRENT = 4;
const NEGATIVE_TTL_MS = 60_000;
const MAX_SKIN_BYTES = 1_024 * 1_024;

const UUID_DASHED_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_BARE_RE = /^[0-9a-fA-F]{32}$/;

interface CacheEntry {
    dataUrl: string | null;
    at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

// a small semaphore: profile + texture are two round trips per player
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
    if (active < MAX_CONCURRENT) {
        active++;
        return;
    }
    await new Promise<void>((resolve) => waiters.push(() => { active++; resolve(); }));
}

function release(): void {
    active--;
    const next = waiters.shift();
    if (next) next();
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await apiFetch(url, { signal: controller.signal });
    } catch (err) {
        console.debug(`[skins] request failed for ${url}:`, String(err));
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function formatUuid(bare: string): string {
    const hex = bare.toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function uuidFromName(name: string): Promise<string | null> {
    const local = await uuidForPlayerName(name);
    if (local) return local;
    const res = await fetchWithTimeout(`${NAME_URL}${encodeURIComponent(name)}`);
    if (!res || res.status === 204 || res.status === 404) return null;
    if (!res.ok) {
        console.debug(`[skins] name lookup for "${name}" returned ${res.status}`);
        return null;
    }
    const body = (await res.json()) as { id?: unknown };
    return typeof body?.id === "string" && UUID_BARE_RE.test(body.id)
        ? formatUuid(body.id)
        : null;
}

async function skinUrlForUuid(uuid: string): Promise<string | null> {
    const res = await fetchWithTimeout(`${PROFILE_URL}${uuid.replace(/-/g, "")}`);
    if (!res || !res.ok) {
        if (res) console.debug(`[skins] profile for ${uuid} returned ${res.status}`);
        return null;
    }
    const body = (await res.json()) as {
        properties?: Array<{ name?: unknown; value?: unknown }>;
    };
    const encoded = body?.properties?.find((p) => p?.name === "textures")?.value;
    if (typeof encoded !== "string") return null;
    try {
        const decoded = JSON.parse(
            Buffer.from(encoded, "base64").toString("utf8"),
        ) as { textures?: { SKIN?: { url?: unknown } } };
        const url = decoded?.textures?.SKIN?.url;
        if (typeof url !== "string" || !url.startsWith("http")) return null;
        // Mojang still hands back http://; the CDN serves it over https
        return url.replace(/^http:\/\//, "https://");
    } catch (err) {
        console.debug(`[skins] undecodable texture property for ${uuid}:`, String(err));
        return null;
    }
}

async function fetchSkinBytes(url: string): Promise<Uint8Array | null> {
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) {
        if (res) console.debug(`[skins] texture fetch returned ${res.status}`);
        return null;
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_SKIN_BYTES) {
        console.debug(`[skins] skin exceeds size cap (${declared} bytes)`);
        return null;
    }
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > MAX_SKIN_BYTES) {
        console.debug(`[skins] skin exceeds size cap (${buffer.byteLength} bytes)`);
        return null;
    }
    return buffer;
}

function remember(key: string, dataUrl: string | null): void {
    cache.set(key, { dataUrl, at: Date.now() });
    while (cache.size > MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

async function resolveHead(
    name: string | undefined,
    uuid: string | undefined,
    size: number,
): Promise<string | null> {
    let resolved = "";
    if (uuid) {
        const trimmed = uuid.trim().toLowerCase();
        if (UUID_DASHED_RE.test(trimmed)) resolved = trimmed;
        else if (UUID_BARE_RE.test(trimmed)) resolved = formatUuid(trimmed);
    }
    if (!resolved && name) resolved = (await uuidFromName(name)) ?? "";
    if (!resolved) return null;

    const skinUrl = await skinUrlForUuid(resolved);
    if (!skinUrl) return null;
    const bytes = await fetchSkinBytes(skinUrl);
    if (!bytes) return null;
    const head = composeHeadFromSkin(bytes, size);
    if (!head) return null;
    return `data:image/png;base64,${Buffer.from(head).toString("base64")}`;
}

/**
 * A layered head data URL for a player, or null when none is available.
 * A null (no skin, no UUID, network failure) is a documented degradation:
 * callers fall back to the generic person icon, and the failure is logged.
 */
export function getHeadDataUrl(inputs: {
    name?: string;
    uuid?: string;
    size?: number;
}): Promise<string | null> {
    const name = typeof inputs?.name === "string" ? inputs.name.trim() : "";
    const uuid = typeof inputs?.uuid === "string" ? inputs.uuid.trim() : "";
    if (!name && !uuid) return Promise.resolve(null);

    const key = (uuid || name).toLowerCase();
    const cached = cache.get(key);
    if (cached && (cached.dataUrl !== null || Date.now() - cached.at < NEGATIVE_TTL_MS)) {
        return Promise.resolve(cached.dataUrl);
    }
    const existing = inflight.get(key);
    if (existing) return existing;

    const size = clampHeadSize(inputs?.size);
    const promise = (async () => {
        await acquire();
        try {
            const dataUrl = await resolveHead(name || undefined, uuid || undefined, size);
            remember(key, dataUrl);
            if (!dataUrl) console.debug(`[skins] no head for ${key}`);
            return dataUrl;
        } finally {
            release();
            inflight.delete(key);
        }
    })();
    inflight.set(key, promise);
    return promise;
}
