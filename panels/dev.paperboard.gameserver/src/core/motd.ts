// The server list message (server.properties `motd`) in Minecraft's legacy
// "§" formatting: a color code resets the style, a format code adds to it,
// and §r returns to the list's default gray. Every supported server reads
// the same codes; none takes hex colors from server.properties.
//
// The editor works on a MotdDoc: one styled cell per character, with "\n"
// cells between lines, so an offset into the doc is an offset into the text.

export const DEFAULT_MOTD = "A Minecraft Server";

/** the Multiplayer list shows two lines */
export const MOTD_LINES = 2;

/** characters kept, not counting § codes or line breaks */
export const MAX_MOTD_CHARS = 256;

export const MOTD_COLORS = [
    { code: "0", name: "Black", hex: "#000000" },
    { code: "1", name: "Dark Blue", hex: "#0000AA" },
    { code: "2", name: "Dark Green", hex: "#00AA00" },
    { code: "3", name: "Dark Aqua", hex: "#00AAAA" },
    { code: "4", name: "Dark Red", hex: "#AA0000" },
    { code: "5", name: "Dark Purple", hex: "#AA00AA" },
    { code: "6", name: "Gold", hex: "#FFAA00" },
    { code: "7", name: "Gray", hex: "#AAAAAA" },
    { code: "8", name: "Dark Gray", hex: "#555555" },
    { code: "9", name: "Blue", hex: "#5555FF" },
    { code: "a", name: "Green", hex: "#55FF55" },
    { code: "b", name: "Aqua", hex: "#55FFFF" },
    { code: "c", name: "Red", hex: "#FF5555" },
    { code: "d", name: "Light Purple", hex: "#FF55FF" },
    { code: "e", name: "Yellow", hex: "#FFFF55" },
    { code: "f", name: "White", hex: "#FFFFFF" },
] as const;

export const MOTD_FORMATS = [
    { code: "l", key: "bold", name: "Bold" },
    { code: "o", key: "italic", name: "Italic" },
    { code: "n", key: "underline", name: "Underline" },
    { code: "m", key: "strikethrough", name: "Strikethrough" },
    { code: "k", key: "obfuscated", name: "Obfuscated" },
] as const;

export const MOTD_COLOR_HEX = new Map<string, string>(MOTD_COLORS.map((c) => [c.code, c.hex]));

export interface MotdStyle {
    /** a MOTD_COLORS code; undefined is the list's default gray */
    color?: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    obfuscated: boolean;
}

export interface MotdCell {
    ch: string;
    style: MotdStyle;
}

export type MotdDoc = MotdCell[];

export interface MotdSegment extends MotdStyle {
    text: string;
}

export const plainStyle = (color?: string): MotdStyle => ({
    color,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    obfuscated: false,
});

const FORMAT_BY_CODE = new Map<string, (typeof MOTD_FORMATS)[number]["key"]>(
    MOTD_FORMATS.map((f) => [f.code, f.key]),
);

export const sameStyle = (a: MotdStyle, b: MotdStyle): boolean =>
    a.color === b.color && MOTD_FORMATS.every((f) => a[f.key] === b[f.key]);

/** the style after a code, the way the game reads it */
function readCode(style: MotdStyle, code: string): MotdStyle {
    if (MOTD_COLOR_HEX.has(code)) return plainStyle(code);
    if (code === "r") return plainStyle();
    const key = FORMAT_BY_CODE.get(code);
    return key ? { ...style, [key]: true } : style;
}

/** one cell per character; unknown and dangling codes are dropped like the game drops them */
export function docFromMotd(raw: string, start: MotdStyle = plainStyle()): MotdDoc {
    const doc: MotdDoc = [];
    let style = start;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch !== "§") {
            doc.push({ ch, style });
            continue;
        }
        const code = raw[i + 1]?.toLowerCase();
        if (code === undefined) break;
        i++;
        style = readCode(style, code);
    }
    return doc;
}

/** the § string for a doc: the fewest codes that reproduce each cell's style */
export function motdFromDoc(doc: MotdDoc): string {
    let out = "";
    let current = plainStyle();
    for (const cell of doc) {
        if (cell.ch !== "\n" && !sameStyle(cell.style, current)) {
            const next = cell.style;
            const keepsFormats = MOTD_FORMATS.every((f) => !current[f.key] || next[f.key]);
            let base = current;
            if (next.color !== current.color || !keepsFormats) {
                out += next.color ? `§${next.color}` : "§r";
                base = plainStyle(next.color);
            }
            for (const f of MOTD_FORMATS) if (next[f.key] && !base[f.key]) out += `§${f.code}`;
            current = next;
        }
        out += cell.ch;
    }
    return out;
}

/** one array of styled runs per line */
export function parseMotd(raw: string): MotdSegment[][] {
    const lines: MotdSegment[][] = [[]];
    for (const cell of docFromMotd(raw)) {
        if (cell.ch === "\n") {
            lines.push([]);
            continue;
        }
        const line = lines[lines.length - 1];
        const last = line[line.length - 1];
        if (last && sameStyle(last, cell.style)) last.text += cell.ch;
        else line.push({ ...cell.style, text: cell.ch });
    }
    return lines;
}

/** the style new text takes at a caret: the character before it, else the one after */
export function styleAt(doc: MotdDoc, offset: number): MotdStyle {
    const before = doc[offset - 1];
    if (before && before.ch !== "\n") return before.style;
    const after = doc[offset];
    if (after && after.ch !== "\n") return after.style;
    return plainStyle();
}

/**
 * Replaces [start, end) with `cells`. Line breaks past MOTD_LINES become
 * spaces and characters past MAX_MOTD_CHARS are dropped.
 */
export function replaceRange(
    doc: MotdDoc,
    start: number,
    end: number,
    cells: MotdDoc,
): { doc: MotdDoc; caret: number } {
    const kept = [...doc.slice(0, start), ...doc.slice(end)];
    let lines = kept.filter((c) => c.ch === "\n").length + 1;
    let room = MAX_MOTD_CHARS - kept.filter((c) => c.ch !== "\n").length;
    const inserted: MotdDoc = [];
    for (const cell of cells) {
        if (cell.ch === "\n" && lines >= MOTD_LINES) {
            if (room <= 0) continue;
            inserted.push({ ch: " ", style: cell.style });
            room--;
        } else if (cell.ch === "\n") {
            inserted.push(cell);
            lines++;
        } else if (room > 0) {
            inserted.push(cell);
            room--;
        }
    }
    return {
        doc: [...kept.slice(0, start), ...inserted, ...kept.slice(start)],
        caret: start + inserted.length,
    };
}

/** a code applied to a style: a color or §r replaces, a format toggles */
export function styleWithCode(style: MotdStyle, code: string): MotdStyle {
    if (MOTD_COLOR_HEX.has(code)) return { ...style, color: code };
    if (code === "r") return plainStyle();
    const key = FORMAT_BY_CODE.get(code);
    return key ? { ...style, [key]: !style[key] } : style;
}

/**
 * The style a selection shows: a format counts when every character has
 * it, a color when every character shares it.
 */
export function selectionStyle(doc: MotdDoc, start: number, end: number): MotdStyle {
    const cells = doc.slice(start, end).filter((c) => c.ch !== "\n");
    if (cells.length === 0) return styleAt(doc, start);
    const color = cells.every((c) => c.style.color === cells[0].style.color) ? cells[0].style.color : undefined;
    const style = plainStyle(color);
    for (const f of MOTD_FORMATS) style[f.key] = cells.every((c) => c.style[f.key]);
    return style;
}

/**
 * Applies a code to [start, end): a color or §r to every character, and a
 * format toggles off when every character already has it, on otherwise.
 */
export function applyCode(doc: MotdDoc, start: number, end: number, code: string): MotdDoc {
    const key = FORMAT_BY_CODE.get(code);
    const turnOff = key !== undefined && selectionStyle(doc, start, end)[key];
    return doc.map((cell, i) => {
        if (i < start || i >= end || cell.ch === "\n") return cell;
        if (key) return { ...cell, style: { ...cell.style, [key]: !turnOff } };
        return { ...cell, style: styleWithCode(cell.style, code) };
    });
}
