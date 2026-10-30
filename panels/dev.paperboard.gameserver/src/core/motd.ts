// The server list message (server.properties `motd`) in Minecraft's legacy
// "§" formatting: a color code resets the style, a format code adds to it,
// and §r returns to the list's default gray. Every supported server reads
// the same codes; none takes hex colors from server.properties.
//
// The editor works on a MotdDoc: one styled cell per character, with "\n"
// cells between lines, so an offset into the doc is an offset into the text.
// A MotdDialect turns a doc into a game's own text and back; Minecraft's is
// minecraftMotd below, and another game's lives with that game.

// paper-literal-ok-file: the colour table is Minecraft's legacy palette, data not styling

export const DEFAULT_MOTD = "A Minecraft Server";

/** the Multiplayer list shows two lines */
export const MOTD_LINES = 2;

/** characters kept, not counting § codes or line breaks */
export const MAX_MOTD_CHARS = 256;

/**
 * Minecraft's sixteen colours, redrawn to read on Paperboard's light and
 * dark surfaces instead of the game's black list box: each keeps the game
 * colour's hue, at a lightness with at least 4:1 contrast in its theme. The
 * grays keep their order from darkest to lightest in both themes, so White
 * is a light gray on a light surface rather than invisible.
 */
export const MOTD_COLORS = [
    { code: "0", name: "Black", light: "oklch(0.2 0 0)", dark: "oklch(0.64 0 0)" },
    { code: "1", name: "Dark Blue", light: "oklch(0.42 0.19 264)", dark: "oklch(0.66 0.16 264)" },
    { code: "2", name: "Dark Green", light: "oklch(0.45 0.14 142)", dark: "oklch(0.68 0.17 142)" },
    { code: "3", name: "Dark Aqua", light: "oklch(0.45 0.09 195)", dark: "oklch(0.68 0.11 195)" },
    { code: "4", name: "Dark Red", light: "oklch(0.45 0.17 27)", dark: "oklch(0.67 0.18 27)" },
    { code: "5", name: "Dark Purple", light: "oklch(0.42 0.18 328)", dark: "oklch(0.67 0.19 328)" },
    { code: "6", name: "Gold", light: "oklch(0.55 0.14 70)", dark: "oklch(0.8 0.16 70)" },
    { code: "7", name: "Gray", light: "oklch(0.48 0 0)", dark: "oklch(0.84 0 0)" },
    { code: "8", name: "Dark Gray", light: "oklch(0.36 0 0)", dark: "oklch(0.74 0 0)" },
    { code: "9", name: "Blue", light: "oklch(0.5 0.2 275)", dark: "oklch(0.74 0.15 275)" },
    { code: "a", name: "Green", light: "oklch(0.53 0.17 142)", dark: "oklch(0.86 0.2 142)" },
    { code: "b", name: "Aqua", light: "oklch(0.53 0.1 195)", dark: "oklch(0.86 0.12 195)" },
    { code: "c", name: "Red", light: "oklch(0.53 0.2 25)", dark: "oklch(0.74 0.17 25)" },
    { code: "d", name: "Light Purple", light: "oklch(0.52 0.22 328)", dark: "oklch(0.78 0.17 328)" },
    { code: "e", name: "Yellow", light: "oklch(0.54 0.13 105)", dark: "oklch(0.92 0.17 105)" },
    { code: "f", name: "White", light: "oklch(0.58 0 0)", dark: "oklch(1 0 0)" },
] as const;

/** a colour as one CSS value that follows the element's colour scheme */
export const motdColorCss = (color: { light: string; dark: string }) => `light-dark(${color.light}, ${color.dark})`;

export const MOTD_FORMATS = [
    { code: "l", key: "bold", name: "Bold" },
    { code: "o", key: "italic", name: "Italic" },
    { code: "n", key: "underline", name: "Underline" },
    { code: "m", key: "strikethrough", name: "Strikethrough" },
    { code: "k", key: "obfuscated", name: "Obfuscated" },
] as const;

export const MOTD_COLOR_CODES = new Set<string>(MOTD_COLORS.map((c) => c.code));

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
    if (MOTD_COLOR_CODES.has(code)) return plainStyle(code);
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

/** How one game writes a styled message, and how much of it the game shows. */
export interface MotdDialect {
    /** the format codes the game reads; colours are always MOTD_COLORS */
    formats: readonly (typeof MOTD_FORMATS)[number][];
    lines: number;
    /** characters kept, not counting markup or line breaks */
    maxChars: number;
    /** the MOTD_COLORS code text without a colour is drawn in */
    defaultColor: string;
    /** one cell per character; text without markup takes `start` */
    parse(raw: string, start?: MotdStyle): MotdDoc;
    serialize(doc: MotdDoc): string;
}

/** one array of styled runs per line */
export function parseMotd(raw: string, dialect: MotdDialect = minecraftMotd): MotdSegment[][] {
    const lines: MotdSegment[][] = [[]];
    for (const cell of dialect.parse(raw)) {
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
 * Replaces [start, end) with `cells`. Line breaks past the dialect's lines
 * become spaces and characters past its maxChars are dropped.
 */
export function replaceRange(
    doc: MotdDoc,
    start: number,
    end: number,
    cells: MotdDoc,
    limits: Pick<MotdDialect, "lines" | "maxChars"> = minecraftMotd,
): { doc: MotdDoc; caret: number } {
    const kept = [...doc.slice(0, start), ...doc.slice(end)];
    let lines = kept.filter((c) => c.ch === "\n").length + 1;
    let room = limits.maxChars - kept.filter((c) => c.ch !== "\n").length;
    const inserted: MotdDoc = [];
    for (const cell of cells) {
        if (cell.ch === "\n" && lines >= limits.lines) {
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
    if (MOTD_COLOR_CODES.has(code)) return { ...style, color: code };
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

/** Minecraft's server list message: § codes, two lines, the list's gray. */
export const minecraftMotd: MotdDialect = {
    formats: MOTD_FORMATS,
    lines: MOTD_LINES,
    maxChars: MAX_MOTD_CHARS,
    defaultColor: "7",
    parse: docFromMotd,
    serialize: motdFromDoc,
};
