export const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;
export const SERVER_PROC_ID = "mc-server";

// names reach console commands raw (`kick ${name}`, `data get entity
// ${name}`): validated at every service boundary, never just UI-side.
// A newline anywhere in these values is a second console command.
export function assertPlayerName(name: unknown): string {
    const s = String(name ?? "").trim();
    if (!PLAYER_NAME_PATTERN.test(s)) {
        throw new Error(`Refusing unsafe player name: ${JSON.stringify(name)}`);
    }
    return s;
}

export function assertSingleLine(value: unknown, what: string, max = 200): string {
    const s = String(value ?? "");
    if (s.includes("\n") || s.includes("\r")) {
        throw new Error(`Refusing multi-line ${what}: a line break would inject a second console command`);
    }
    if (s.length > max) {
        throw new Error(`Refusing overlong ${what}: ${s.length} chars past the ${max} cap`);
    }
    return s;
}

export interface PlayerStatData {
    health?: number;
    food?: number;
    xpLevel?: number;
    xpProgress?: number;
}

export const STAT_QUERIES: { field: keyof PlayerStatData; path: string }[] = [
    { field: "health", path: "Health" },
    { field: "food", path: "foodLevel" },
    { field: "xpLevel", path: "XpLevel" },
    { field: "xpProgress", path: "XpP" },
];

export function normalizePlayerKey(name: string): string {
    return name.toLowerCase();
}

export function consoleTimeToSeconds(clean: string): number | undefined {
    const m = clean.match(/\[(\d{2}):(\d{2}):(\d{2})\]/);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function extractJoinedName(clean: string): string | undefined {
    return clean.match(/([a-zA-Z0-9_]{1,16})\s+joined the game/i)?.[1];
}

export function extractLeftName(clean: string): string | undefined {
    return clean.match(/([a-zA-Z0-9_]{1,16})\s+left the game/i)?.[1];
}

export function extractListedNames(clean: string): string[] | undefined {
    const listMatch = clean.match(/players online[^:]*:\s*(.+)/i);
    if (!listMatch) return undefined;
    return listMatch[1]
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter((n) => PLAYER_NAME_PATTERN.test(n));
}

// the `list` poll's header line, with or without names attached: an empty
// server answers "There are 0 of a max of 20 players online:" which
// extractListedNames (correctly) refuses, but it is still poll chatter, not
// log output. Only the server's canonical header matches — player chat
// keeps flowing to the chat feed regardless.
export function isPlayerListResponse(clean: string): boolean {
    return /there are \d+ of (?:a )?max of \d+ players online\s*:?/i.test(clean);
}

export function extractStatValue(clean: string): number | undefined {
    const match = clean.match(/has the following entity data:\s*(-?\d+(?:\.\d+)?)/i);
    if (!match) return undefined;
    return Number(match[1]);
}

export interface PlayerPosition {
    x: number;
    y: number;
    z: number;
    dimension: string;
}

// `data get entity <name> Pos` → "<name> has the following entity data: [x, y, z]"
// (doubles carry a trailing d/f). Returns undefined for any other line so it
// never steals a stat or gamerule response.
export function extractPosition(
    clean: string,
): { x: number; y: number; z: number } | undefined {
    const match = clean.match(/has the following entity data:\s*\[([^\]]+)\]/i);
    if (!match) return undefined;
    const parts = match[1]
        .split(",")
        .map((p) => Number(p.trim().replace(/[dDfF]$/, "")));
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) {
        return undefined;
    }
    return { x: parts[0], y: parts[1], z: parts[2] };
}

// `data get entity <name> Dimension` → "... entity data: \"minecraft:overworld\""
export function extractDimension(clean: string): string | undefined {
    return clean.match(/has the following entity data:\s*"([^"]+)"/i)?.[1];
}
