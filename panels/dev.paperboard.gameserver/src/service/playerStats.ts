import { minecraftOf } from "../games/minecraft/state";
import type { Server } from "./server";
import { errorMessage } from "./api";
import { listDirectory } from "./filesystem";
import {
    parsePlayerStats,
    type PlayerStatSummary,
} from "../core/playerStats";
import { PANEL_ID } from "./types";
import { resolveLevelName } from "./worlds";

// a name looked up from Mojang is trusted for an hour; renames are rare and
// a roster of a thousand players must not ask again on every visit
const NAME_TTL_MS = 60 * 60 * 1000;

/** the name Mojang or GeyserMC gave for this uuid within the hour, if one was asked */
export function cachedName(ctx: Server, uuid: string): string | undefined {
    const known = minecraftOf(ctx).lists.names.get(uuid);
    return known && Date.now() - known.at < NAME_TTL_MS ? known.name : undefined;
}

const UUID_FILE_RE =
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/;

// bounds a lookup that iterates every stats file: a thousandth-player world
// must not turn one action into an unbounded read
const MAX_PLAYER_STATS = 2000;

/** a file the server writes, or null when it has not written it; one it can't read throws why */
async function readJson(ctx: Server, relative: string): Promise<unknown> {
    const content = await ctx.files.read(relative, PANEL_ID);
    if (!content) return null;
    try {
        return JSON.parse(content);
    } catch (err) {
        throw new Error(`${relative} is not valid JSON: ${errorMessage(err)}`);
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
// whose usercache entry expired resolvable by either direction. usercache is
// applied last: the server rewrites it on every join, while the lists keep
// the name a player had when they were added, so a renamed player resolves
// to their new name.
export async function resolvePlayerIdentities(ctx: Server): Promise<Map<string, string>> {
    const [usercache, ops, whitelist, banned] = await Promise.all([
        readJson(ctx, "usercache.json"),
        readJson(ctx, "ops.json"),
        readJson(ctx, "whitelist.json"),
        readJson(ctx, "banned-players.json"),
    ]);
    const names = new Map<string, string>();
    for (const raw of [banned, whitelist, ops, usercache]) collectNames(raw, names);
    return names;
}

export async function usernameFromUuid(ctx: Server, rawUuid: string): Promise<string | null> {
    const uuid = String(rawUuid ?? "").trim().toLowerCase();
    if (!uuid) return null;
    const names = await resolvePlayerIdentities(ctx);
    return names.get(uuid) ?? null;
}

export async function uuidForPlayerName(ctx: Server, rawName: string): Promise<string | null> {
    const wanted = String(rawName ?? "").trim().toLowerCase();
    if (!wanted) return null;
    const names = await resolvePlayerIdentities(ctx);
    for (const [uuid, name] of names) {
        if (name.toLowerCase() === wanted) return uuid;
    }
    return null;
}

// new worlds nest per-player data under players/ (26.x); older ones keep
// stats/ at the world root. Check the modern path first.
async function resolveStatsDir(ctx: Server, level: string): Promise<string | null> {
    const candidates = [`${level}/players/stats`, `${level}/stats`];
    for (const candidate of candidates) {
        if (await ctx.files.exists(candidate, PANEL_ID)) return candidate;
    }
    return null;
}

export async function listPlayerStats(
    ctx: Server,
): Promise<PlayerStatSummary[]> {
    const level = await resolveLevelName(ctx);
    const names = await resolvePlayerIdentities(ctx);

    const statsDir = await resolveStatsDir(ctx, level);
    if (!statsDir) return [];
    const entries = await listDirectory(ctx, statsDir);
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
        const parsed = parsePlayerStats(await readJson(ctx, `${statsDir}/${entry}`));
        if (!parsed) continue;
        const name = cachedName(ctx, uuid) ?? names.get(uuid) ?? uuid;
        out.push({ uuid, name, ...parsed });
    }
    return out;
}
