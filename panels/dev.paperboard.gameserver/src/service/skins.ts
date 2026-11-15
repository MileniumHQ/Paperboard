// Player heads. Java players' skins come from Mojang; Bedrock players'
// (Floodgate uuids) from GeyserMC, which keeps the skin Floodgate uploaded
// for each Xbox account as a Minecraft texture. Neither profile endpoint
// sends CORS headers, so the browser cannot read them directly; the service
// fetches, composites the head (face + hat) and returns a data URL the panel
// can draw. A skin's texture URL names its content (a new skin is a new URL),
// so heads are kept by that URL and can never show an old skin; which skin a
// player wears is asked again after a minute, so a changed skin shows within
// one. Lookups for the same player share one request, and lookups are
// concurrency capped: a roster of a hundred players issues a bounded number
// of requests at a time.
import { apiFetch } from "../lib/userAgent";
import { composeHeadFromSkin, clampHeadSize } from "../core/skin";
import { gamertagOf, floodgateUuid, xuidOfFloodgateUuid, type BedrockNaming } from "../core/bedrock";
import { uuidForPlayerName } from "./playerStats";
import { fetchMojang, formatUuid, profileForName } from "./mojang";
import { errorMessage, LimitedQueue } from "@mileniumhq/paperapi";
import { skinUrlForXuid, xuidForGamertag } from "./xbox";

const PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/";
const MAX_CONCURRENT = 4;
const MAX_SKIN_BYTES = 1_024 * 1_024;
const SKIN_TTL_MS = 60_000;
const MAX_KEPT = 512;

// uuid → the skin they wore when last asked (null: none); texture URL and
// size → head. Both are bounded, oldest first out.
const skins = new Map<string, { url: string | null; at: number }>();
const heads = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function keep<V>(map: Map<string, V>, key: string, value: V): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_KEPT) map.delete(map.keys().next().value!);
}

const UUID_DASHED_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_BARE_RE = /^[0-9a-fA-F]{32}$/;

// profile + texture are two round trips per player
const limited = new LimitedQueue(MAX_CONCURRENT).run;

// the server's own records first: a Bedrock player who has joined is in
// them under the name Floodgate gave them
async function uuidFromName(name: string, naming: () => Promise<BedrockNaming | null>): Promise<string | null> {
    const local = await uuidForPlayerName(name);
    if (local) return local;
    const gamertag = gamertagOf(name, await naming());
    if (gamertag) {
        const xuid = await xuidForGamertag(gamertag);
        return xuid ? floodgateUuid(xuid) : null;
    }
    return (await profileForName(name))?.uuid ?? null;
}

async function mojangSkinUrl(uuid: string): Promise<string | null> {
    const res = await fetchMojang(`${PROFILE_URL}${uuid.replace(/-/g, "")}`);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Mojang's profile for ${uuid} answered ${res.status}`);
    const body = (await res.json()) as {
        properties?: Array<{ name?: unknown; value?: unknown }>;
    };
    const encoded = body?.properties?.find((p) => p?.name === "textures")?.value;
    if (encoded === undefined) return null;
    let decoded: { textures?: { SKIN?: { url?: unknown } } };
    try {
        decoded = JSON.parse(Buffer.from(String(encoded), "base64").toString("utf8"));
    } catch (err) {
        throw new Error(`Mojang's skin record for ${uuid} could not be read: ${errorMessage(err)}`);
    }
    // an account on the default skin has none of its own
    const url = decoded?.textures?.SKIN?.url;
    if (url === undefined) return null;
    if (typeof url !== "string" || !url.startsWith("http")) throw new Error(`Mojang's skin record for ${uuid} has no skin address`);
    // Mojang still hands back http://; the CDN serves it over https
    return url.replace(/^http:\/\//, "https://");
}

function skinUrlForUuid(uuid: string): Promise<string | null> {
    const xuid = xuidOfFloodgateUuid(uuid);
    return xuid ? skinUrlForXuid(xuid) : mojangSkinUrl(uuid);
}

async function fetchSkinBytes(url: string): Promise<Uint8Array> {
    const res = await fetchMojang(url);
    if (!res.ok) throw new Error(`The skin download answered ${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_SKIN_BYTES) throw new Error(`The skin is ${declared} bytes, more than the ${MAX_SKIN_BYTES} a skin can be`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength > MAX_SKIN_BYTES) throw new Error(`The skin is ${buffer.byteLength} bytes, more than the ${MAX_SKIN_BYTES} a skin can be`);
    return buffer;
}

async function resolveHead(
    name: string,
    uuid: string,
    size: number,
    naming: () => Promise<BedrockNaming | null>,
): Promise<string | null> {
    let resolved = "";
    if (uuid) {
        const trimmed = uuid.toLowerCase();
        if (UUID_DASHED_RE.test(trimmed)) resolved = trimmed;
        else if (UUID_BARE_RE.test(trimmed)) resolved = formatUuid(trimmed);
    }
    if (!resolved && name) resolved = (await uuidFromName(name, naming)) ?? "";
    if (!resolved) return null;

    let skin = skins.get(resolved);
    if (!skin || Date.now() - skin.at >= SKIN_TTL_MS) {
        // a lookup that throws is asked again next time, never remembered as "no skin"
        skin = { url: await skinUrlForUuid(resolved), at: Date.now() };
        keep(skins, resolved, skin);
    }
    if (!skin.url) return null;
    const headKey = `${size}:${skin.url}`;
    const kept = heads.get(headKey);
    if (kept) return kept;
    const head = await composeHeadFromSkin(await fetchSkinBytes(skin.url), size);
    if (!head) throw new Error("The skin is not a Minecraft skin picture");
    const dataUrl = `data:image/png;base64,${Buffer.from(head).toString("base64")}`;
    keep(heads, headKey, dataUrl);
    return dataUrl;
}

/**
 * A layered head data URL for a player, or null when they have no skin of
 * their own (or no account): the generic person icon is then the right
 * picture. A lookup that fails throws why, for the page to show.
 * `naming` is Floodgate's, read only when a name has to be looked up.
 */
export async function getHeadDataUrl(inputs: {
    name?: string;
    uuid?: string;
    size?: number;
    naming: () => Promise<BedrockNaming | null>;
}): Promise<string | null> {
    const name = typeof inputs?.name === "string" ? inputs.name.trim() : "";
    const uuid = typeof inputs?.uuid === "string" ? inputs.uuid.trim() : "";
    if (!name && !uuid) throw new Error("A player's head needs their name or uuid");

    const size = clampHeadSize(inputs?.size);
    const key = `${size}:${uuid.toLowerCase() || name.toLowerCase()}`;
    const running = inflight.get(key);
    if (running) return running;
    const lookup = limited(() => resolveHead(name, uuid, size, inputs.naming)).finally(() => inflight.delete(key));
    inflight.set(key, lookup);
    return lookup;
}
