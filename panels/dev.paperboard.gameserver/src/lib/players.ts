import { createStateSignal } from "@mileniumhq/paperui/headless";
import type { PlayerStatData, PlayerPosition } from "../core/players";
import type { PlayerStatSummary } from "../core/playerStats";
import { serverCalls } from "./api";

export type { PlayerStatData, PlayerPosition, PlayerStatSummary };
export { PLAYER_NAME_PATTERN, SERVER_PROC_ID } from "../core/players";

// presence tracked from the service
// every push and poll is a fresh copy; these keep what did not change
// (createStateSignal), so an unchanged copy notifies no one
export const [onlinePlayerNames, setOnlinePlayerNames] = createStateSignal<Set<string>>(new Set());

export const [seenPlayerNames, setSeenPlayerNames] = createStateSignal<Set<string>>(new Set());

export const [playerStats, setPlayerStats] = createStateSignal<Map<string, PlayerStatData>>(new Map());

export const [playerPlaytime, setPlayerPlaytime] = createStateSignal<Map<string, number>>(new Map());

// live coordinates for the map, synced from the service
export const [playerPositions, setPlayerPositions] = createStateSignal<Map<string, PlayerPosition>>(new Map());

// offline statistics read from the world's stats files, keyed by uuid
export const [playerStatSummaries, setPlayerStatSummaries] = createStateSignal<Map<string, PlayerStatSummary>>(new Map());

// rejects when the stats can't be read; the caller shows why. A poll that
// reads the same numbers keeps the map and every entry it had
export async function loadPlayerStats(): Promise<void> {
    const list = await serverCalls.listPlayerStats();
    const next = new Map<string, PlayerStatSummary>();
    for (const entry of list ?? []) {
        if (entry && typeof entry.uuid === "string") {
            next.set(entry.uuid.toLowerCase(), entry);
        }
    }
    setPlayerStatSummaries(next);
}

export function getPlayerPlaytimeSeconds(name: string): number | undefined {
    const key = name.toLowerCase();
    return playerPlaytime().get(key);
}

// local echo of a delete the service has made (it forgets the player
// itself); uuid also drops the offline stats summary, which would otherwise
// list the player again until the next stats poll
export function forgetPlayerData(name: string, uuid?: string) {
    const key = name.toLowerCase();
    if (uuid) {
        setPlayerStatSummaries((prev) => {
            const next = new Map(prev);
            next.delete(uuid.toLowerCase());
            return next;
        });
    }
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
    setPlayerPositions((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
    });
}

// The live polls: each asks the running game to report, and the answer
// arrives as state. Each rejects when the game could not be asked; the
// page that polls shows why.
export const queryPlayerStats = (name: string): Promise<unknown> => serverCalls.queryPlayerStats({ player: name });

export const queryOnlinePlayers = (): Promise<unknown> => serverCalls.queryOnlinePlayers();

export const queryPlayerPositions = (): Promise<unknown> => serverCalls.queryPlayerPositions();
