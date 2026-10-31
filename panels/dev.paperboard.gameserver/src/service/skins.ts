// Player heads from Mojang skins. The profile endpoint sends no CORS
// headers, so the browser cannot read them directly; the service
// fetches, composites the head (face + hat) and returns a data URL the panel
// can draw. Nothing is kept: every lookup asks again, so a changed skin shows
// the next time a head is drawn. Lookups are concurrency capped — a roster of
// a hundred players issues a bounded number of requests at a time.
import { apiFetch } from "../lib/userAgent";
import { composeHeadFromSkin, clampHeadSize } from "../core/skin";
import { uuidForPlayerName } from "./playerStats";
import { formatUuid, profileForName } from "./mojang";

const PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 4;
const MAX_SKIN_BYTES = 1_024 * 1_024;

const UUID_DASHED_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_BARE_RE = /^[0-9a-fA-F]{32}$/;

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

// the server's own records first, then Mojang
async function uuidFromName(name: string): Promise<string | null> {
    const local = await uuidForPlayerName(name);
    if (local) return local;
    try {
        return (await profileForName(name))?.uuid ?? null;
    } catch (err) {
        console.debug(`[skins] name lookup for "${name}" failed:`, String(err));
        return null;
    }
}

async function mojangSkinUrl(uuid: string): Promise<string | null> {
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

async function resolveHead(
    name: string,
    uuid: string,
    size: number,
): Promise<string | null> {
    let resolved = "";
    if (uuid) {
        const trimmed = uuid.toLowerCase();
        if (UUID_DASHED_RE.test(trimmed)) resolved = trimmed;
        else if (UUID_BARE_RE.test(trimmed)) resolved = formatUuid(trimmed);
    }
    if (!resolved && name) resolved = (await uuidFromName(name)) ?? "";
    if (!resolved) return null;

    const skinUrl = await mojangSkinUrl(resolved);
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
export async function getHeadDataUrl(inputs: {
    name?: string;
    uuid?: string;
    size?: number;
}): Promise<string | null> {
    const name = typeof inputs?.name === "string" ? inputs.name.trim() : "";
    const uuid = typeof inputs?.uuid === "string" ? inputs.uuid.trim() : "";
    if (!name && !uuid) return null;

    await acquire();
    try {
        const dataUrl = await resolveHead(name, uuid, clampHeadSize(inputs?.size));
        if (!dataUrl) console.debug(`[skins] no head for ${uuid || name}`);
        return dataUrl;
    } finally {
        release();
    }
}
