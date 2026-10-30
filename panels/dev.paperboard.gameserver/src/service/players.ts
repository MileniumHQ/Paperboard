import { serverLocal } from "./scope";
import { files as fileApi, type ServiceContext } from "./api";
import { writeServerLineBestEffort } from "./serverConsole";
import {
    type GameServerState,
    type PlayerStatData,
    PLAYER_NAME_PATTERN,
    SERVER_PROC_ID,
    appendCapped,
    MAX_BUFFERED_ENTRIES,
} from "./types";
import {
    STAT_QUERIES,
    assertPlayerName,
    consoleTimeToSeconds,
    extractDimension,
    extractJoinedName,
    extractLeftName,
    extractListedNames,
    extractListCounts,
    extractPosition,
    extractStatValue,
    normalizePlayerKey,
    type PlayerPosition,
} from "../core/players";
import { trashRemovePathsWith } from "./trash";
import { uuidForPlayerName } from "./playerStats";
import { resolveLevelName } from "./worlds";
import { makeTrashRemoveDeps } from "./trashDeps";
import { PANEL_ID } from "./types";
import { TRIGGER_IDS } from "./contract";

const local = serverLocal(() => ({ lastJoinAt: new Map<string, number>(), pendingStatFields: [] as { player: string; field: keyof PlayerStatData }[], recentNames: [] as string[], onNamesChanged: null as (() => void) | null, pendingPositionQueries: [] as PendingPositionQuery[] }));

export { usernameFromUuid } from "./playerStats";

export type { PlayerStatData };
export { PLAYER_NAME_PATTERN, SERVER_PROC_ID, STAT_QUERIES };

// Recently seen player names in their original casing (state keys are
// normalized), newest last. This backs the join/leave triggers' player
// dropdown: the options must match the event payload's casing, and the list
// must stay bounded like every other buffer in the panel.

/** The gameserver service wires this to republish the triggers' options. */
export function setPlayerNamesChangedHandler(handler: (() => void) | null): void {
    local().onNamesChanged = handler;
}

function rememberPlayerName(name: string): void {
    const key = normalizePlayerKey(name);
    const existing = local().recentNames.findIndex((n) => normalizePlayerKey(n) === key);
    if (existing >= 0) local().recentNames.splice(existing, 1);
    local().recentNames.push(name);
    while (local().recentNames.length > MAX_BUFFERED_ENTRIES) local().recentNames.shift();
    local().onNamesChanged?.();
}

function nameKnown(name: string): boolean {
    const key = normalizePlayerKey(name);
    return local().recentNames.some((n) => normalizePlayerKey(n) === key);
}

/** Newest first, original casing — the order the trigger dropdown shows. */
export function playerNameOptions(): string[] {
    return [...local().recentNames].reverse();
}

// join timestamps are keyed per username and only deleted on leave —
// without a cap, spoofed joins grow the map forever. Map preserves
// insertion order, so evict oldest first.
function rememberJoin(key: string, ts: number): void {
    local().lastJoinAt.delete(key);
    local().lastJoinAt.set(key, ts);
    while (local().lastJoinAt.size > MAX_BUFFERED_ENTRIES) {
        const oldest = local().lastJoinAt.keys().next();
        if (oldest.done) break;
        local().lastJoinAt.delete(oldest.value);
    }
}

// test seam: lets tests assert the bound without 1000 log lines of setup
export const __playersTest = {
    lastJoinSize: () => local().lastJoinAt.size,
    clearJoins: () => local().lastJoinAt.clear(),
    clearNames: () => {
        local().recentNames.length = 0;
        local().onNamesChanged = null;
    },
    remember: (name: string) => rememberPlayerName(name),
};

// per-player records grow with unique players; keep them bounded the same
// way every other buffer in the panel is (evict oldest insertion first)
function capEntries<T>(
    record: Record<string, T>,
    max = MAX_BUFFERED_ENTRIES,
): Record<string, T> {
    const keys = Object.keys(record);
    if (keys.length <= max) return record;
    const next: Record<string, T> = {};
    for (const key of keys.slice(keys.length - max)) next[key] = record[key];
    return next;
}

export function trackPlayerActivity(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): void {
    const ts = consoleTimeToSeconds(clean);

    const joined = extractJoinedName(clean);
    if (joined) {
        const key = normalizePlayerKey(joined);
        if (ts !== undefined) rememberJoin(key, ts);
        rememberPlayerName(joined);
        ctx.setState((prev) => {
            // seenPlayers is history, not presence: cap it like every other
            // buffer instead of growing one entry per unique join forever
            const seen = prev.seenPlayers.includes(key)
                ? prev.seenPlayers
                : appendCapped(prev.seenPlayers, key);
            const online = prev.onlinePlayers.includes(key)
                ? prev.onlinePlayers
                : [...prev.onlinePlayers, key];
            return { seenPlayers: seen, onlinePlayers: online };
        });
        ctx.emitTrigger(TRIGGER_IDS.playerJoined, joined);
        return;
    }

    const left = extractLeftName(clean);
    if (left) {
        const key = normalizePlayerKey(left);
        const joinAt = local().lastJoinAt.get(key);
        let sessionSeconds = 0;
        if (ts !== undefined && joinAt !== undefined) {
            sessionSeconds = ts - joinAt;
            if (sessionSeconds < 0) sessionSeconds += 86400;
        }
        local().lastJoinAt.delete(key);

        ctx.setState((prev) => {
            const online = prev.onlinePlayers.filter((p) => p !== key);
            const playtime = { ...prev.playerPlaytime };
            playtime[key] = (playtime[key] ?? 0) + sessionSeconds;
            return { onlinePlayers: online, playerPlaytime: capEntries(playtime) };
        });
        ctx.emitTrigger(TRIGGER_IDS.playerLeft, left);
        return;
    }

    // the running server's own player cap; an empty server also clears a
    // roster that went stale while nobody was watching the joins
    const counts = extractListCounts(clean);
    if (counts) {
        ctx.setState(counts.online === 0 ? { maxPlayers: counts.max, onlinePlayers: [] } : { maxPlayers: counts.max });
    }

    const names = extractListedNames(clean);
    if (names) {
        for (const name of names) {
            if (ts !== undefined && !local().lastJoinAt.has(name)) rememberJoin(name, ts);
            // the list lowercases names; keep the join's original casing when
            // one is already known so the options match the event payload
            if (!nameKnown(name)) rememberPlayerName(name);
        }
        ctx.setState((prev) => {
            const seen = new Set([...prev.seenPlayers, ...names]);
            return {
                onlinePlayers: names,
                // same cap as the join path: history stays bounded
                seenPlayers: Array.from(seen).slice(-MAX_BUFFERED_ENTRIES),
            };
        });
    }
}

export function handleStatResponse(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): boolean {
    const value = extractStatValue(clean);
    if (value === undefined) return false;
    const pending = local().pendingStatFields.shift();
    if (!pending) return true;
    ctx.setState((prev) => {
        const stats = { ...prev.playerStats };
        const data = { ...(stats[pending.player] ?? {}) };
        data[pending.field] = value;
        stats[pending.player] = data;
        return { playerStats: capEntries(stats) };
    });
    return true;
}

export function queryOnlinePlayers(ctx: ServiceContext<GameServerState>): void {
    if (ctx.state.serverStatus === "online") {
        writeServerLineBestEffort("list\n");
    }
}

export function queryPlayerStats(
    ctx: ServiceContext<GameServerState>,
    name: string,
): void {
    if (ctx.state.serverStatus !== "online") return;
    // boundary: the name reaches `data get entity` raw — UI checks don't count
    const safe = assertPlayerName(name);
    const key = normalizePlayerKey(safe);
    local().pendingStatFields = local().pendingStatFields.filter((p) => p.player !== key);
    for (const { field, path } of STAT_QUERIES) {
        local().pendingStatFields.push({ player: key, field });
        writeServerLineBestEffort(`data get entity ${safe} ${path}\n`);
    }
    // bounded: bursts of stat queries from many players evict oldest first
    while (local().pendingStatFields.length > MAX_BUFFERED_ENTRIES) {
        local().pendingStatFields.shift();
    }
}

// ─── Map positions ───────────────────────────────────────────────────
// `data get entity <name> Pos` / `Dimension`, matched to responses in the
// same FIFO order the commands were written. Results land in state so the
// map updates through the normal bridge sync.
type PendingPositionQuery = { player: string; kind: "pos" | "dim" };

export function queryPlayerPositions(ctx: ServiceContext<GameServerState>): void {
    if (ctx.state.serverStatus !== "online") return;
    const players = ctx.state.onlinePlayers;
    if (players.length === 0) {
        // refresh presence first; positions follow on the next poll
        queryOnlinePlayers(ctx);
        return;
    }
    const queried = new Set(players.map(normalizePlayerKey));
    local().pendingPositionQueries = local().pendingPositionQueries.filter(
        (p) => !queried.has(p.player),
    );
    for (const name of players) {
        let safe: string;
        try {
            safe = assertPlayerName(name);
        } catch (err) {
            console.debug("[Service:Players] skipping unsafe player key:", String(err));
            continue;
        }
        const key = normalizePlayerKey(safe);
        local().pendingPositionQueries.push({ player: key, kind: "pos" });
        local().pendingPositionQueries.push({ player: key, kind: "dim" });
        writeServerLineBestEffort(`data get entity ${safe} Pos\n`);
        writeServerLineBestEffort(`data get entity ${safe} Dimension\n`);
    }
    while (local().pendingPositionQueries.length > MAX_BUFFERED_ENTRIES) {
        local().pendingPositionQueries.shift();
    }
    // drop markers for players who left since the last poll
    ctx.setState((prev) => {
        const next: Record<string, PlayerPosition> = {};
        for (const [key, value] of Object.entries(prev.playerPositions)) {
            if (queried.has(key)) next[key] = value;
        }
        return { playerPositions: next };
    });
}

export function handlePositionResponse(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): boolean {
    const pending = local().pendingPositionQueries[0];
    if (!pending) return false;

    if (pending.kind === "pos") {
        const pos = extractPosition(clean);
        if (!pos) return false;
        local().pendingPositionQueries.shift();
        ctx.setState((prev) => {
            const existing = prev.playerPositions[pending.player];
            return {
                playerPositions: {
                    ...prev.playerPositions,
                    [pending.player]: {
                        ...pos,
                        dimension: existing?.dimension ?? "minecraft:overworld",
                    },
                },
            };
        });
        return true;
    }

    const dimension = extractDimension(clean);
    if (!dimension) return false;
    local().pendingPositionQueries.shift();
    ctx.setState((prev) => {
        const existing = prev.playerPositions[pending.player];
        return {
            playerPositions: {
                ...prev.playerPositions,
                [pending.player]: {
                    x: existing?.x ?? 0,
                    y: existing?.y ?? 0,
                    z: existing?.z ?? 0,
                    dimension,
                },
            },
        };
    });
    return true;
}

export function forgetPlayerData(
    ctx: ServiceContext<GameServerState>,
    name: string,
): void {
    const key = normalizePlayerKey(assertPlayerName(name));
    local().lastJoinAt.delete(key);
    ctx.setState((prev) => {
        const seen = prev.seenPlayers.filter((p) => p !== key);
        const online = prev.onlinePlayers.filter((p) => p !== key);
        const stats = { ...prev.playerStats };
        delete stats[key];
        const playtime = { ...prev.playerPlaytime };
        delete playtime[key];
        const positions = { ...prev.playerPositions };
        delete positions[key];
        return {
            seenPlayers: seen,
            onlinePlayers: online,
            playerStats: stats,
            playerPlaytime: playtime,
            playerPositions: positions,
        };
    });
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// player-data delete: trash first, then remove (see core/trash.ts), under
// the server's actual level-name — never a hardcoded "world". The uuid is
// asserted, not trusted: it reaches shell paths.
export async function deletePlayerData(
    ctx: ServiceContext<GameServerState>,
    playerName: string,
    uuid?: string,
): Promise<void> {
    const safeName = assertPlayerName(playerName);
    let safeUuid = String(uuid ?? "").trim();
    if (!UUID_RE.test(safeUuid)) {
        // flows name a player, not a UUID: resolve it from the server's
        // own player files instead of asking the author to look it up
        const resolved = await uuidForPlayerName(safeName);
        if (!resolved) {
            throw new Error(
                `No UUID on file for "${safeName}" — the player must have joined this server once.`,
            );
        }
        safeUuid = resolved;
    }
    const level = await resolveLevelName();
    // both layouts: 26.x worlds nest player files under players/, older
    // ones keep them at the world root, and an upgraded server can hold both
    await trashRemovePathsWith(
        makeTrashRemoveDeps(),
        [
            `${level}/players/data/${safeUuid}.dat`,
            `${level}/players/data/${safeUuid}.dat_old`,
            `${level}/players/advancements/${safeUuid}.json`,
            `${level}/players/stats/${safeUuid}.json`,
            `${level}/playerdata/${safeUuid}.dat`,
            `${level}/playerdata/${safeUuid}.dat_old`,
            `${level}/advancements/${safeUuid}.json`,
            `${level}/stats/${safeUuid}.json`,
        ],
    );
    await forgetCachedProfile(safeUuid);
    forgetPlayerData(ctx, safeName);
}

// usercache.json is what lists a player who has only ever joined; leaving
// the entry would keep a deleted player on the roster. ops, whitelist and
// bans are the owner's settings and stay.
async function forgetCachedProfile(uuid: string): Promise<void> {
    const content = await fileApi.read("usercache.json", PANEL_ID);
    if (!content) return;
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        throw new Error(`usercache.json is not valid JSON: ${String(err)}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error("usercache.json is not a list of players");
    }
    const wanted = uuid.toLowerCase();
    const kept = parsed.filter(
        (entry) =>
            !(entry && typeof entry.uuid === "string" && entry.uuid.toLowerCase() === wanted),
    );
    if (kept.length === parsed.length) return;
    await fileApi.write("usercache.json", JSON.stringify(kept), PANEL_ID);
}
