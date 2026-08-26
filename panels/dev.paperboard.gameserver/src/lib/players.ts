import { createSignal } from "solid-js";
import { fileApi, processApi } from "@paperboard-dev/paperapi";
import stripAnsi from "strip-ansi";
import { SERVER_PROC_ID, PLAYER_NAME_PATTERN, serverStatus } from "./server";

// Live player presence, tracked from console output.
export const [onlinePlayerNames, setOnlinePlayerNames] = createSignal<Set<string>>(new Set());

export const [seenPlayerNames, setSeenPlayerNames] = createSignal<Set<string>>(new Set());

// Centralized field mapping so NBT drift across versions is fixed in one place
export interface PlayerStatData {
    health?: number;
    food?: number;
    xpLevel?: number;
    xpProgress?: number;
}

export const [playerStats, setPlayerStats] = createSignal<Map<string, PlayerStatData>>(
    new Map(),
);

// Playtime in seconds; lastJoinAt tracks when an online player joined
export const [playerPlaytime, setPlayerPlaytime] = createSignal<Map<string, number>>(
    new Map(),
);
const lastJoinAt = new Map<string, number>();

function consoleTimeToSeconds(clean: string): number | undefined {
    const m = clean.match(/\[(\d{2}):(\d{2}):(\d{2})\]/);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function getPlayerPlaytimeSeconds(name: string): number | undefined {
    const key = name.toLowerCase();
    const accumulated = playerPlaytime().get(key);
    const joinAt = lastJoinAt.get(key);
    if (joinAt === undefined) return accumulated;
    const now = consoleTimeToSeconds(
        `[${new Date().toTimeString().slice(0, 8)}]`,
    )!;
    let live = now - joinAt;
    if (live < 0) live += 86400;
    return (accumulated ?? 0) + live;
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
    lastJoinAt.delete(key);
}

const STAT_QUERIES: { field: keyof PlayerStatData; path: string }[] = [
    { field: "health", path: "Health" },
    { field: "food", path: "foodLevel" },
    { field: "xpLevel", path: "XpLevel" },
    { field: "xpProgress", path: "XpP" },
];

// Responses arrive in order, so pending fields form a FIFO queue per batch
let pendingStatFields: { player: string; field: keyof PlayerStatData }[] = [];

export function queryPlayerStats(name: string) {
    if (serverStatus() !== "online") return;
    const key = name.toLowerCase();
    pendingStatFields = pendingStatFields.filter((p) => p.player !== key);
    for (const { field, path } of STAT_QUERIES) {
        pendingStatFields.push({ player: key, field });
        processApi.write(SERVER_PROC_ID, `data get entity ${name} ${path}\n`);
    }
}

export function handleStatResponse(clean: string) {
    const match = clean.match(/has the following entity data:\s*(-?\d+(?:\.\d+)?)/i);
    if (!match) return false;
    const pending = pendingStatFields.shift();
    if (!pending) return true;
    const value = Number(match[1]);
    setPlayerStats((prev) => {
        const next = new Map(prev);
        const data = { ...(next.get(pending.player) ?? {}) };
        data[pending.field] = value;
        next.set(pending.player, data);
        return next;
    });
    return true;
}

// Tracks joins/leaves and `list` command responses from raw console lines.
export function trackPlayerActivity(clean: string) {
    const ts = consoleTimeToSeconds(clean);

    const joined = clean.match(/([a-zA-Z0-9_]{1,16})\s+joined the game/i)?.[1];
    if (joined) {
        markPlayerSeen(joined);
        const key = joined.toLowerCase();
        setOnlinePlayerNames((prev) => new Set(prev).add(key));
        if (ts !== undefined) lastJoinAt.set(key, ts);
        return;
    }

    const left = clean.match(/([a-zA-Z0-9_]{1,16})\s+left the game/i)?.[1];
    if (left) {
        const key = left.toLowerCase();
        setOnlinePlayerNames((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
        });
        const joinAt = lastJoinAt.get(key);
        if (ts !== undefined && joinAt !== undefined) {
            let session = ts - joinAt;
            if (session < 0) session += 86400;
            setPlayerPlaytime((prev) => {
                const next = new Map(prev);
                next.set(key, (prev.get(key) ?? 0) + session);
                return next;
            });
        }
        lastJoinAt.delete(key);
        return;
    }

    const listMatch = clean.match(/players online[^:]*:\s*(.+)/i);
    if (listMatch) {
        const names = listMatch[1]
            .split(",")
            .map((n) => n.trim())
            .filter((n) => PLAYER_NAME_PATTERN.test(n));
        setOnlinePlayerNames(new Set(names.map((n) => n.toLowerCase())));
        for (const name of names) {
            markPlayerSeen(name);
            const key = name.toLowerCase();
            if (ts !== undefined && !lastJoinAt.has(key)) lastJoinAt.set(key, ts);
        }
    }
}

function markPlayerSeen(name: string) {
    setSeenPlayerNames((prev) => {
        if (prev.has(name)) return prev;
        const next = new Set(prev);
        next.add(name);
        return next;
    });
}

export function queryOnlinePlayers() {
    if (serverStatus() === "online") {
        processApi.write(SERVER_PROC_ID, "list\n");
    }
}

// Replay the log through the tracker so presence survives panel reloads
export async function restorePlayerStateFromLog() {
    try {
        const content = await fileApi.read("logs/latest.log");
        if (!content) return;
        for (const line of content.split("\n")) {
            const clean = stripAnsi(line);
            if (clean.trim()) trackPlayerActivity(clean);
        }

        // Log may predate a server stop; `list` resync corrects presence
        if (!(await processApi.exists(SERVER_PROC_ID))) {
            setOnlinePlayerNames(new Set<string>());
        }
    } catch (err) {
        console.error("[Server] Failed to restore player state from logs:", err);
    }
}
