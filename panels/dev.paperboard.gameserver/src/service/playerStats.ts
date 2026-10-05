import { files as fileApi, type ServiceContext } from "@mileniumhq/paperapi";
import { listDirectory } from "../lib/filesystem";
import {
    parsePlayerStats,
    type PlayerStatSummary,
} from "../core/playerStats";
import { type GameServerState, PANEL_ID } from "./types";
import { resolveLevelName } from "./worlds";

const UUID_FILE_RE =
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/;

// bounds a lookup that iterates every stats file: a thousandth-player world
// must not turn one action into an unbounded read
const MAX_PLAYER_STATS = 2000;

async function readJson(relative: string): Promise<unknown> {
    try {
        const content = await fileApi.read(relative, PANEL_ID);
        if (!content) return null;
        return JSON.parse(content);
    } catch (err) {
        console.debug(`[Service:PlayerStats] unreadable ${relative}:`, String(err));
        return null;
    }
}

// usercache/ops/whitelist/banned all carry { uuid, name } — union them so a
// player whose usercache entry expired still resolves to a name
function collectNames(raw: unknown, into: Map<string, string>): void {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const uuid = (entry as { uuid?: unknown }).uuid;
        const name = (entry as { name?: unknown }).name;
        if (typeof uuid === "string" && typeof name === "string") {
            into.set(uuid.toLowerCase(), name);
        }
    }
}

export type { PlayerStatSummary };

// the { uuid, name } registries the server writes; the union keeps a player
// whose usercache entry expired resolvable by either direction
export async function resolvePlayerIdentities(): Promise<Map<string, string>> {
    const [usercache, ops, whitelist, banned] = await Promise.all([
        readJson("usercache.json"),
        readJson("ops.json"),
        readJson("whitelist.json"),
        readJson("banned-players.json"),
    ]);
    const names = new Map<string, string>();
    for (const raw of [usercache, ops, whitelist, banned]) collectNames(raw, names);
    return names;
}

export async function usernameFromUuid(rawUuid: string): Promise<string | null> {
    const uuid = String(rawUuid ?? "").trim().toLowerCase();
    if (!uuid) return null;
    const names = await resolvePlayerIdentities();
    return names.get(uuid) ?? null;
}

export async function uuidForPlayerName(rawName: string): Promise<string | null> {
    const wanted = String(rawName ?? "").trim().toLowerCase();
    if (!wanted) return null;
    const names = await resolvePlayerIdentities();
    for (const [uuid, name] of names) {
        if (name.toLowerCase() === wanted) return uuid;
    }
    return null;
}

// new worlds nest per-player data under players/ (26.x); older ones keep
// stats/ at the world root. Check the modern path first.
async function resolveStatsDir(level: string): Promise<string | null> {
    const candidates = [`${level}/players/stats`, `${level}/stats`];
    for (const candidate of candidates) {
        try {
            if (await fileApi.exists(candidate, PANEL_ID)) return candidate;
        } catch (err) {
            console.debug(`[Service:PlayerStats] stats dir probe failed for "${candidate}":`, String(err));
        }
    }
    return null;
}

export async function listPlayerStats(
    _ctx: ServiceContext<GameServerState>,
): Promise<PlayerStatSummary[]> {
    const level = await resolveLevelName();
    const names = await resolvePlayerIdentities();

    const statsDir = await resolveStatsDir(level);
    if (!statsDir) return [];
    const entries = await listDirectory(statsDir);
    const out: PlayerStatSummary[] = [];
    for (const entry of entries) {
        if (out.length >= MAX_PLAYER_STATS) {
            console.warn(
                `[Service:PlayerStats] stats listing truncated at ${MAX_PLAYER_STATS} entries`,
            );
            break;
        }
        const match = UUID_FILE_RE.exec(entry);
        if (!match) continue;
        const uuid = match[1].toLowerCase();
        const parsed = parsePlayerStats(await readJson(`${statsDir}/${entry}`));
        if (!parsed) continue;
        out.push({ uuid, name: names.get(uuid) ?? uuid, ...parsed });
    }
    return out;
}
