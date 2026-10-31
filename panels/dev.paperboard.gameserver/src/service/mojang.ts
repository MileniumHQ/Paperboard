// Mojang's account lookups: a name to its account (uuid + current casing),
// and a uuid to the name it has now. Names change; uuids do not. A missing
// account is null, a request that could not be answered throws, so callers
// can tell "no such player" apart from "Mojang was unreachable".
import { apiFetch } from "../lib/userAgent";

const PROFILE_URL = "https://sessionserver.mojang.com/session/minecraft/profile/";
const NAME_URL = "https://api.mojang.com/users/profiles/minecraft/";
const FETCH_TIMEOUT_MS = 10_000;

const UUID_BARE_RE = /^[0-9a-fA-F]{32}$/;

export interface MojangProfile {
    uuid: string;
    name: string;
}

/** dashed lowercase form of a 32-hex uuid */
export function formatUuid(bare: string): string {
    const hex = bare.toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function fetchMojang(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await apiFetch(url, { signal: controller.signal });
    } catch (err) {
        throw new Error(`Mojang could not be reached: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    } finally {
        clearTimeout(timer);
    }
}

function parseProfile(body: unknown): MojangProfile | null {
    const { id, name } = (body ?? {}) as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !UUID_BARE_RE.test(id) || typeof name !== "string") return null;
    return { uuid: formatUuid(id), name };
}

/** the account a name belongs to now, or null when no account has it */
export async function profileForName(name: string): Promise<MojangProfile | null> {
    const res = await fetchMojang(`${NAME_URL}${encodeURIComponent(name)}`);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Mojang's name lookup for "${name}" answered ${res.status}`);
    return parseProfile(await res.json());
}

/** the account behind a uuid, with its current name; null when there is none */
export async function profileForUuid(uuid: string): Promise<MojangProfile | null> {
    const res = await fetchMojang(`${PROFILE_URL}${uuid.replace(/-/g, "")}`);
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`Mojang's profile lookup for ${uuid} answered ${res.status}`);
    return parseProfile(await res.json());
}
