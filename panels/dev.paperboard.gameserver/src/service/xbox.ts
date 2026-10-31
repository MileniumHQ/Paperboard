// Xbox accounts and their skins, from GeyserMC's global API: the same one
// Floodgate asks for `fwhitelist` and uploads Bedrock skins to. It only knows
// a gamertag once its player has joined some Geyser server. A missing account
// or skin is null; a request that could not be answered throws, so callers
// can tell "no such player" apart from "GeyserMC was unreachable".
import { apiFetch } from "../lib/userAgent";

const GLOBAL_API = "https://api.geysermc.org/v2";
const TEXTURE_URL = "https://textures.minecraft.net/texture/";
const FETCH_TIMEOUT_MS = 10_000;
const TEXTURE_ID_RE = /^[0-9a-f]{1,128}$/;

async function fetchGeyserMC(path: string): Promise<Response> {
    try {
        return await apiFetch(`${GLOBAL_API}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
        throw new Error(`GeyserMC could not be reached: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
}

async function errorMessage(res: Response): Promise<string> {
    try {
        const body = (await res.json()) as { message?: unknown };
        if (typeof body?.message === "string") return body.message;
    } catch (err) {
        console.debug("[Service:Xbox] error body is not JSON:", String(err));
    }
    return `HTTP ${res.status}`;
}

/** the XUID of the Xbox account with this gamertag, or null when GeyserMC has none on record */
export async function xuidForGamertag(gamertag: string): Promise<string | null> {
    const res = await fetchGeyserMC(`/xbox/xuid/${encodeURIComponent(gamertag)}`);
    // 503 is its answer for a gamertag it has not seen ("Unable to find user
    // in our cache"), 400 for one no gamertag can be
    if (res.status === 503 || res.status === 400 || res.status === 404) {
        console.debug(`[Service:Xbox] no xuid for "${gamertag}": ${await errorMessage(res)}`);
        return null;
    }
    if (!res.ok) throw new Error(`GeyserMC's gamertag lookup for "${gamertag}" answered: ${await errorMessage(res)}`);
    const { xuid } = (await res.json()) as { xuid?: unknown };
    if (typeof xuid === "number" && Number.isSafeInteger(xuid) && xuid > 0) return String(xuid);
    if (typeof xuid === "string" && /^[1-9][0-9]*$/.test(xuid)) return xuid;
    return null;
}

/** the gamertag the account has now, or null when GeyserMC has none on record */
export async function gamertagForXuid(xuid: string): Promise<string | null> {
    const res = await fetchGeyserMC(`/xbox/gamertag/${encodeURIComponent(xuid)}`);
    if (res.status === 503 || res.status === 400 || res.status === 404) {
        console.debug(`[Service:Xbox] no gamertag for ${xuid}: ${await errorMessage(res)}`);
        return null;
    }
    if (!res.ok) throw new Error(`GeyserMC's account lookup for ${xuid} answered: ${await errorMessage(res)}`);
    const { gamertag } = (await res.json()) as { gamertag?: unknown };
    return typeof gamertag === "string" && gamertag ? gamertag : null;
}

/**
 * The skin texture Floodgate last uploaded for this player, as a Minecraft
 * texture URL, or null when GeyserMC holds none (it answers `{}` then).
 */
export async function skinUrlForXuid(xuid: string): Promise<string | null> {
    const res = await fetchGeyserMC(`/skin/${encodeURIComponent(xuid)}`);
    if (!res.ok) throw new Error(`GeyserMC's skin lookup for ${xuid} answered: ${await errorMessage(res)}`);
    const { texture_id: textureId } = (await res.json()) as { texture_id?: unknown };
    if (typeof textureId !== "string" || !TEXTURE_ID_RE.test(textureId)) return null;
    return `${TEXTURE_URL}${textureId}`;
}
