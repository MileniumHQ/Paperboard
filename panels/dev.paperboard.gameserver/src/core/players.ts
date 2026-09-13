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

export function extractStatValue(clean: string): number | undefined {
    const match = clean.match(/has the following entity data:\s*(-?\d+(?:\.\d+)?)/i);
    if (!match) return undefined;
    return Number(match[1]);
}
