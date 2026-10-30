// Terraria's message of the day: one line of chat sent to each player who
// joins, coloured with chat tags, [c/RRGGBB:text]. The editor offers the same
// sixteen colours as Minecraft's, written as the hex below; a tag in any other
// colour, and every other tag ([i:item] and the like), stays as text so it
// reaches the game exactly as it was written.

// paper-literal-ok-file: the hex values are the colours written into Terraria's chat tags, data not styling

import { plainStyle, type MotdDialect, type MotdDoc, type MotdStyle } from "../../core/motd";

/** each MOTD_COLORS code as its colour in game */
const TAG_COLORS: Readonly<Record<string, string>> = {
    "0": "000000", "1": "0000AA", "2": "00AA00", "3": "00AAAA",
    "4": "AA0000", "5": "AA00AA", "6": "FFAA00", "7": "AAAAAA",
    "8": "555555", "9": "5555FF", a: "55FF55", b: "55FFFF",
    c: "FF5555", d: "FF55FF", e: "FFFF55", f: "FFFFFF",
};
const CODE_BY_HEX = new Map(Object.entries(TAG_COLORS).map(([code, hex]) => [hex, code]));
const COLOR_TAG = /\[c\/([0-9a-f]{6}):([^\]]*)\]/gi;

/** the server config holds the message on one line */
const MAX_CHARS = 256;

function parse(raw: string, start: MotdStyle = plainStyle()): MotdDoc {
    const doc: MotdDoc = [];
    const push = (text: string, style: MotdStyle) => {
        for (const ch of text) doc.push({ ch, style });
    };
    let at = 0;
    for (const match of raw.matchAll(COLOR_TAG)) {
        const code = CODE_BY_HEX.get(match[1].toUpperCase());
        if (!code) continue;
        push(raw.slice(at, match.index), start);
        push(match[2], plainStyle(code));
        at = match.index + match[0].length;
    }
    push(raw.slice(at), start);
    return doc;
}

function serialize(doc: MotdDoc): string {
    let out = "";
    let run = "";
    let color: string | undefined;
    const flush = () => {
        // a "]" would close the tag early, so it is written outside one
        if (color) out += run.split("]").map((part) => (part ? `[c/${TAG_COLORS[color!]}:${part}]` : "")).join("]");
        else out += run;
        run = "";
    };
    for (const cell of doc) {
        if (cell.ch === "\n") continue;
        if (cell.style.color !== color) {
            flush();
            color = cell.style.color;
        }
        run += cell.ch;
    }
    flush();
    return out;
}

/** Colours only; text without one is the message of the day's yellow. */
export const terrariaMotd: MotdDialect = {
    formats: [],
    lines: 1,
    maxChars: MAX_CHARS,
    defaultColor: "e",
    parse,
    serialize,
};
