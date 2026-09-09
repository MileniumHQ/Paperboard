import { processApi, type ServiceContext } from "@paperboard-dev/paperapi";
import {
    type GameServerState,
    type PlayerStatData,
    PLAYER_NAME_PATTERN,
    SERVER_PROC_ID,
} from "./types";
import {
    STAT_QUERIES,
    consoleTimeToSeconds,
    extractJoinedName,
    extractLeftName,
    extractListedNames,
    extractStatValue,
    normalizePlayerKey,
} from "../core/players";

export type { PlayerStatData };
export { PLAYER_NAME_PATTERN, SERVER_PROC_ID, STAT_QUERIES };

const lastJoinAt = new Map<string, number>();
let pendingStatFields: { player: string; field: keyof PlayerStatData }[] = [];

export function trackPlayerActivity(
    ctx: ServiceContext<GameServerState>,
    clean: string,
): void {
    const ts = consoleTimeToSeconds(clean);

    const joined = extractJoinedName(clean);
    if (joined) {
        const key = normalizePlayerKey(joined);
        if (ts !== undefined) lastJoinAt.set(key, ts);
        ctx.setState((prev) => {
            const seen = prev.seenPlayers.includes(key)
                ? prev.seenPlayers
                : [...prev.seenPlayers, key];
            const online = prev.onlinePlayers.includes(key)
                ? prev.onlinePlayers
                : [...prev.onlinePlayers, key];
            return { seenPlayers: seen, onlinePlayers: online };
        });
        ctx.emitTrigger("player-joined", joined);
        return;
    }

    const left = extractLeftName(clean);
    if (left) {
        const key = normalizePlayerKey(left);
        const joinAt = lastJoinAt.get(key);
        let sessionSeconds = 0;
        if (ts !== undefined && joinAt !== undefined) {
            sessionSeconds = ts - joinAt;
            if (sessionSeconds < 0) sessionSeconds += 86400;
        }
        lastJoinAt.delete(key);

        ctx.setState((prev) => {
            const online = prev.onlinePlayers.filter((p) => p !== key);
            const playtime = { ...prev.playerPlaytime };
            playtime[key] = (playtime[key] ?? 0) + sessionSeconds;
            return { onlinePlayers: online, playerPlaytime: playtime };
        });
        ctx.emitTrigger("player-left", left);
        return;
    }

    const names = extractListedNames(clean);
    if (names) {
        for (const name of names) {
            if (ts !== undefined && !lastJoinAt.has(name)) lastJoinAt.set(name, ts);
        }
        ctx.setState((prev) => {
            const seen = new Set([...prev.seenPlayers, ...names]);
            return {
                onlinePlayers: names,
                seenPlayers: Array.from(seen),
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
    const pending = pendingStatFields.shift();
    if (!pending) return true;
    ctx.setState((prev) => {
        const stats = { ...prev.playerStats };
        const data = { ...(stats[pending.player] ?? {}) };
        data[pending.field] = value;
        stats[pending.player] = data;
        return { playerStats: stats };
    });
    return true;
}

export function queryOnlinePlayers(ctx: ServiceContext<GameServerState>): void {
    if (ctx.state.serverStatus === "online") {
        processApi.write(SERVER_PROC_ID, "list\n");
    }
}

export function queryPlayerStats(
    ctx: ServiceContext<GameServerState>,
    name: string,
): void {
    if (ctx.state.serverStatus !== "online") return;
    const key = normalizePlayerKey(name);
    pendingStatFields = pendingStatFields.filter((p) => p.player !== key);
    for (const { field, path } of STAT_QUERIES) {
        pendingStatFields.push({ player: key, field });
        processApi.write(SERVER_PROC_ID, `data get entity ${name} ${path}\n`);
    }
}

export function forgetPlayerData(
    ctx: ServiceContext<GameServerState>,
    name: string,
): void {
    const key = normalizePlayerKey(name);
    lastJoinAt.delete(key);
    ctx.setState((prev) => {
        const seen = prev.seenPlayers.filter((p) => p !== key);
        const online = prev.onlinePlayers.filter((p) => p !== key);
        const stats = { ...prev.playerStats };
        delete stats[key];
        const playtime = { ...prev.playerPlaytime };
        delete playtime[key];
        return {
            seenPlayers: seen,
            onlinePlayers: online,
            playerStats: stats,
            playerPlaytime: playtime,
        };
    });
}
