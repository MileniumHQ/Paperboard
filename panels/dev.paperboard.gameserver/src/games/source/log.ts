// Source servers print their game log to the console with `log on` and
// `sv_logecho 1`, in Valve's HL log standard: each line starts with
// `L MM/DD/YYYY - HH:MM:SS: ` and names a player as
// "Name<userid><steamid><team>". Paperboard reads joins, leaves and chat
// from these lines rather than polling `status`, whose reply the server
// echoes into its console.

export interface SourcePlayerRef {
    name: string;
    /** the server's id for this connection; kickid takes it */
    userId: number;
    /** "[U:1:123]", "BOT" or "Console" */
    steamId: string;
    team: string;
}

export type SourceLogEvent =
    | { kind: "connected"; player: SourcePlayerRef; address: string }
    | { kind: "entered"; player: SourcePlayerRef }
    | { kind: "disconnected"; player: SourcePlayerRef; reason: string }
    | { kind: "say"; player: SourcePlayerRef; team: boolean; text: string }
    | { kind: "renamed"; player: SourcePlayerRef; name: string }
    | { kind: "team"; player: SourcePlayerRef; team: string }
    | { kind: "map"; map: string };

const PREFIX = /^L \d\d\/\d\d\/\d{4} - (\d\d:\d\d:\d\d): /;
// the name may itself hold "<" and quotes; the last three <...> before the closing quote are the fields
const PLAYER = /^"(.*)<(-?\d+)><([^<>]*)><([^<>]*)>" (.*)$/;

/** The line without its log timestamp, or null when it is not a game log line. */
export function logBody(line: string): string | null {
    const match = PREFIX.exec(line);
    return match ? line.slice(match[0].length) : null;
}

/** A game log line as the console shows it: its time, not the whole date stamp. Other lines pass through. */
export function consoleLine(line: string): string {
    const match = PREFIX.exec(line);
    return match ? `[${match[1]}] ${line.slice(match[0].length)}` : line;
}

/** The player a game log line is about, whatever it says of them; their team is current as of the line. */
export function linePlayer(line: string): SourcePlayerRef | null {
    const body = logBody(line.replace(/\r$/, ""));
    const match = body === null ? null : PLAYER.exec(body);
    return match ? { name: match[1]!, userId: Number(match[2]), steamId: match[3]!, team: match[4]! } : null;
}

export function parseLogLine(line: string): SourceLogEvent | null {
    const body = logBody(line.replace(/\r$/, ""));
    if (body === null) return null;
    const map = /^Started map "([^"]+)"/.exec(body);
    if (map) return { kind: "map", map: map[1]! };
    const match = PLAYER.exec(body);
    if (!match) return null;
    const player: SourcePlayerRef = { name: match[1]!, userId: Number(match[2]), steamId: match[3]!, team: match[4]! };
    const rest = match[5]!;
    let m: RegExpExecArray | null;
    if ((m = /^connected, address "([^"]*)"$/.exec(rest))) return { kind: "connected", player, address: m[1]! };
    if (rest === "entered the game") return { kind: "entered", player };
    if ((m = /^disconnected \(reason "(.*)"\)$/.exec(rest))) return { kind: "disconnected", player, reason: m[1]! };
    if ((m = /^(say|say_team) "(.*)"$/.exec(rest))) return { kind: "say", player, team: m[1] === "say_team", text: m[2]! };
    if ((m = /^changed name to "(.*)"$/.exec(rest))) return { kind: "renamed", player, name: m[1]! };
    if ((m = /^joined team "([^"]*)"$/.exec(rest))) return { kind: "team", player, team: m[1]! };
    return null;
}

export interface SourceStatusPlayer {
    userId: number;
    name: string;
    steamId: string;
    /** "mm:ss" or "h:mm:ss" since they connected */
    connected: string;
    ping: number;
    state: string;
    address: string;
}

export interface SourceStatus {
    hostname: string;
    /** the game's own version ("11191711"), not Steam's build */
    version: string;
    map: string;
    humans: number;
    bots: number;
    maxPlayers: number;
    players: SourceStatusPlayer[];
}

/**
 * Reads a `status` reply. Player rows look like
 * `#      2 "Name"            [U:1:123]     01:02   45    0 active 1.2.3.4:27005`;
 * bots have no ping, loss or address.
 */
export function parseStatus(text: string): SourceStatus {
    const lines = text.split(/\r?\n/);
    const field = (name: string) => lines.find((l) => l.startsWith(`${name}`))?.replace(/^[^:]*:\s*/, "") ?? null;
    const hostname = field("hostname");
    const map = field("map");
    const version = field("version")?.split("/")[0]?.trim() ?? "";
    const counts = /^(\d+) humans, (\d+) bots \((\d+)(?:\/\d+)? max\)/.exec(field("players") ?? "");
    if (hostname === null || map === null || !counts) throw new Error("The server's status reply is not in the expected format");
    const players: SourceStatusPlayer[] = [];
    for (const line of lines) {
        const row = /^#\s*(\d+)\s+(?:\d+\s+)?"(.*)"\s+(\S+)\s+(.*)$/.exec(line);
        if (!row) continue;
        const rest = row[4]!.trim().split(/\s+/);
        const human = /^\d+(?::\d+){1,2}$/.test(rest[0] ?? "");
        players.push({
            userId: Number(row[1]),
            name: row[2]!,
            steamId: row[3]!,
            connected: human ? rest[0]! : "",
            ping: human ? Number(rest[1]) : 0,
            state: human ? rest[3] ?? "" : rest.at(-1) ?? "",
            address: human ? rest[4] ?? "" : "",
        });
    }
    return { hostname, version, map: map.split(" ")[0]!, humans: Number(counts[1]), bots: Number(counts[2]), maxPlayers: Number(counts[3]), players };
}

/**
 * Whether a console line reports a failure. Source starts those lines with
 * what failed; mid-line "error" is library chatter such as qhull's precision
 * notes on every map load.
 */
export function isErrorLine(line: string): boolean {
    return /^(Host_Error|FATAL|ERROR|Error[:!]|Failed|Could not|Couldn't|Unable to)\b/i.test(line.trim());
}

/** Steam ids as Source writes them: "[U:1:<account>]". */
export function steamId(value: unknown): string {
    if (typeof value !== "string" || !/^\[U:1:\d{1,10}\]$/.test(value)) throw new Error("Choose a player by their Steam id");
    return value;
}
