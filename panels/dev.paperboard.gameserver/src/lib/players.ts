import { createSignal } from "solid-js";
import { serverBridge } from "./server";
import { ACTION_IDS } from "../service/contract";
import type { PlayerStatData } from "../core/players";

export type { PlayerStatData };
export { PLAYER_NAME_PATTERN, SERVER_PROC_ID } from "../core/players";

// presence tracked from the service
export const [onlinePlayerNames, setOnlinePlayerNames] = createSignal<Set<string>>(new Set());

export const [seenPlayerNames, setSeenPlayerNames] = createSignal<Set<string>>(new Set());

export const [playerStats, setPlayerStats] = createSignal<Map<string, PlayerStatData>>(
    new Map(),
);

export const [playerPlaytime, setPlayerPlaytime] = createSignal<Map<string, number>>(
    new Map(),
);

export function getPlayerPlaytimeSeconds(name: string): number | undefined {
    const key = name.toLowerCase();
    return playerPlaytime().get(key);
}

export function forgetPlayerData(name: string) {
    const key = name.toLowerCase();
    setSeenPlayerNames((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
    });
    setOnlinePlayerNames((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
    });
    setPlayerStats((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
    });
    setPlayerPlaytime((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
    });
    serverBridge.call(ACTION_IDS.forgetPlayerData, { player: name }).catch((err) =>
        console.debug("[players] forgetPlayerData failed:", String(err)),
    );
}

export function queryPlayerStats(name: string) {
    serverBridge.call(ACTION_IDS.queryPlayerStats, { player: name }).catch((err) =>
        console.debug("[players] queryPlayerStats failed:", String(err)),
    );
}

export function queryOnlinePlayers() {
    serverBridge.call(ACTION_IDS.queryOnlinePlayers).catch((err) =>
        console.debug("[players] queryOnlinePlayers failed:", String(err)),
    );
}

export async function restorePlayerStateFromLog() {
    await serverBridge.refreshState();
}
