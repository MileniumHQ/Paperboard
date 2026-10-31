// Java names are letters, digits and underscores. Floodgate names a Bedrock
// player with its username prefix in front ("." by default), so a player name
// also takes the other characters a console command reads as one bare word
// (Brigadier's unquoted strings: . + -), still at most 16 long.
export const JAVA_NAME_PATTERN = /^[a-zA-Z0-9_]{1,16}$/;
export const PLAYER_NAME_PATTERN = /^[a-zA-Z0-9_.+-]{1,16}$/;
const NAME_IN_LINE = "[a-zA-Z0-9_.+-]{1,16}";
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

// Each stat is read with a scale (`data get entity <name> <path> <scale>`)
// because that form's reply names both the path and the player, so a reply
// can never land on the wrong stat or the wrong player, whatever order the
// server answers in or whichever queries it never answers. The scale keeps
// the fraction the integer reply would otherwise floor away.
export const STAT_QUERIES: { field: keyof PlayerStatData; path: string; scale: number }[] = [
    { field: "health", path: "Health", scale: 100 },
    { field: "food", path: "foodLevel", scale: 1 },
    { field: "xpLevel", path: "XpLevel", scale: 1 },
    { field: "xpProgress", path: "XpP", scale: 10000 },
];

export interface StatReply {
    path: string;
    scale: number;
    /** the entity's display name: the player name, plus any team prefix or suffix */
    entity: string;
    value: number;
}

// "<path> on <entity> after scale factor of <scale> is <int>", after the
// log prefix's brackets only, so a chat line ("... <Steve> Health on ...")
// can never pass for one
const STAT_REPLY_RE = /^(?:\[[^\]]*\][\s:]*)*(?:System chat:\s*)?([A-Za-z_]+) on (.+) after scale factor of (\d+(?:\.\d+)?) is (-?\d+)\s*$/;

export function extractStatReply(clean: string): StatReply | undefined {
    const match = clean.trim().match(STAT_REPLY_RE);
    if (!match) return undefined;
    const scale = Number(match[3]);
    if (!(scale > 0)) return undefined;
    return { path: match[1], scale, entity: match[2].trim(), value: Number(match[4]) / scale };
}

/** a reply to one of the panel's own stat queries, by its shape: it stays out of the console even when it comes too late to be read */
export function isStatQueryReply(clean: string): boolean {
    const reply = extractStatReply(clean);
    return !!reply && STAT_QUERIES.some((q) => q.path === reply.path && q.scale === reply.scale);
}

/** whether `player` (a lowercased key) is the player a display name names, ignoring team decoration */
export function displayNameNames(entity: string, player: string): boolean {
    const tokens = entity.match(/[a-zA-Z0-9_.+-]+/g) ?? [];
    return tokens.some((token) => token.toLowerCase() === player);
}

export function normalizePlayerKey(name: string): string {
    return name.toLowerCase();
}

export function consoleTimeToSeconds(clean: string): number | undefined {
    const m = clean.match(/\[(\d{2}):(\d{2}):(\d{2})\]/);
    if (!m) return undefined;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function extractJoinedName(clean: string): string | undefined {
    return clean.match(new RegExp(`(${NAME_IN_LINE})\\s+joined the game`, "i"))?.[1];
}

export function extractLeftName(clean: string): string | undefined {
    return clean.match(new RegExp(`(${NAME_IN_LINE})\\s+left the game`, "i"))?.[1];
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

// the counts in the `list` header, read only from the server's own line
// (start of line or right after the log prefix), so a player chatting
// "There are 9 of a max of 99 players online" can't set them
export function extractListCounts(clean: string): { online: number; max: number } | undefined {
    const match = clean.match(/(?:^|\]:\s*)There are (\d{1,6}) of (?:a )?max of (\d{1,6}) players online/i);
    if (!match) return undefined;
    return { online: Number(match[1]), max: Number(match[2]) };
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
/** whom a `data get entity` reply is about: its display name, after the log prefix */
export function extractEntityDataSubject(clean: string): string | undefined {
    return clean.trim().match(/^(?:\[[^\]]*\][\s:]*)*(?:System chat:\s*)?(.+?) has the following entity data:/)?.[1].trim();
}

export function extractDimension(clean: string): string | undefined {
    return clean.match(/has the following entity data:\s*"([^"]+)"/i)?.[1];
}
