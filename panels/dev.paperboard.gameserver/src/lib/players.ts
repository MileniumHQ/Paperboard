import { createSignal } from "solid-js";
import { serverBridge } from "./server";
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
    serverBridge.actions.forgetPlayerData(name).catch(() => {});
}

export function queryPlayerStats(name: string) {
    serverBridge.actions.queryPlayerStats(name).catch(() => {});
}

export function queryOnlinePlayers() {
    serverBridge.actions.queryOnlinePlayers().catch(() => {});
}

export async function restorePlayerStateFromLog() {
    await serverBridge.refreshState();
}
