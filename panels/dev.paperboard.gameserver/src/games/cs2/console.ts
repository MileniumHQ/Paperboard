// What the Counter-Strike 2 server prints, measured on build 26598758. Its
// game log lines are Valve's HL log standard, as Source 1's, with two
// differences: positions are written into kill lines, and the console's own
// `say` names it as "Console<0>" with no Steam id or team.

/** A player row of `status`: `   2    01:02   45    0     active 786432 1.2.3.4:27005 'Name'`; a bot's time is "BOT" and it has no address. */
export interface Cs2StatusPlayer {
    userId: number;
    name: string;
    bot: boolean;
}

/** The players a `status` answer lists, from the lines between its players header and "#end". */
export function parseStatusPlayers(lines: readonly string[]): Cs2StatusPlayer[] {
    const players: Cs2StatusPlayer[] = [];
    for (const line of lines) {
        // the name is the quoted last column, and may hold quotes itself; no column before it does
        const row = /^\s*(\d+)\s+(\S+)\s+[^']*'(.*)'\s*$/.exec(line);
        if (row) players.push({ userId: Number(row[1]), bot: row[2] === "BOT", name: row[3]! });
    }
    return players;
}

/** Where a `status` answer's player rows begin and end. */
export const STATUS_PLAYERS = "---------players--------";
export const STATUS_END = "#end";

/** The map a "Host activate" line says the server is now running: after a start ("Loading") and after a map change. */
export function activatedMap(line: string): string | null {
    return /^Host activate: (?:Loading|Changelevel) \((.+)\)$/.exec(line.trim())?.[1] ?? null;
}

/** A game log line as Source 1 writes it: the positions Counter-Strike 2 adds after each player are taken out. */
export const withoutPositions = (line: string) => line.replace(/(>") \[-?\d+ -?\d+ -?\d+\]/g, "$1");

/** What the console itself said in chat, from its log line; null for any other line. */
export function consoleSaid(body: string): string | null {
    return /^"Console<0>" say "(.*)"$/.exec(body)?.[1] ?? null;
}

/** Whether a console line reports a failure. The server prints hundreds of lines a start; these are the ones that say something went wrong. */
export function isErrorLine(line: string): boolean {
    return /^(Host_Error|FATAL|ERROR|Error[:!]|Failed|Could not|Couldn't|Unable to|Unknown command)\b/i.test(line.trim());
}
