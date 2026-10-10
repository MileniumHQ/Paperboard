// The server list message (server.properties `motd`) in Minecraft's legacy
// "§" formatting: a color code resets the style, a format code adds to it,
// and §r returns to the list's default gray. Every supported server reads
// the same codes; none takes hex colors from server.properties.

export const DEFAULT_MOTD = "A Minecraft Server";

/** the Multiplayer list shows two lines */
export const MOTD_LINES = 2;

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
    { code: "l", name: "Bold" },
    { code: "o", name: "Italic" },
    { code: "n", name: "Underline" },
    { code: "m", name: "Strikethrough" },
    { code: "k", name: "Obfuscated" },
    { code: "r", name: "Reset" },
] as const;

export interface MotdSegment {
    text: string;
    /** a MOTD_COLORS hex; undefined is the list's default gray */
    color?: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    obfuscated: boolean;
}

const COLOR_BY_CODE = new Map<string, string>(MOTD_COLORS.map((c) => [c.code, c.hex]));

type Style = Omit<MotdSegment, "text">;

const plainStyle = (color?: string): Style => ({
    color,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    obfuscated: false,
});

/** one array of styled runs per line; unknown codes are dropped like the game drops them */
export function parseMotd(raw: string): MotdSegment[][] {
    const lines: MotdSegment[][] = [[]];
    let style = plainStyle();
    let text = "";
    const flush = () => {
        if (text) lines[lines.length - 1].push({ ...style, text });
        text = "";
    };
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === "\n") {
            flush();
            lines.push([]);
            continue;
        }
        if (ch !== "§") {
            text += ch;
            continue;
        }
        const code = raw[i + 1]?.toLowerCase();
        if (code === undefined) break;
        i++;
        flush();
        const color = COLOR_BY_CODE.get(code);
        if (color) style = plainStyle(color);
        else if (code === "r") style = plainStyle();
        else if (code === "l") style = { ...style, bold: true };
        else if (code === "o") style = { ...style, italic: true };
        else if (code === "n") style = { ...style, underline: true };
        else if (code === "m") style = { ...style, strikethrough: true };
        else if (code === "k") style = { ...style, obfuscated: true };
    }
    flush();
    return lines;
}

/** the editor's lines, from a stored MOTD; extra lines stay on the last one */
export function splitMotdLines(raw: string): string[] {
    const lines = raw.split("\n");
    const shown = lines.slice(0, MOTD_LINES - 1);
    shown.push(lines.slice(MOTD_LINES - 1).join(" "));
    return shown;
}

/** the stored MOTD, from the editor's lines; a blank last line is not kept */
export function joinMotdLines(lines: string[]): string {
    const kept = [...lines];
    while (kept.length > 1 && kept[kept.length - 1] === "") kept.pop();
    return kept.join("\n");
}

// the codes that restore the style in effect at `index`, or §r for none
function styleCodesAt(value: string, index: number): string {
    let color = "";
    let formats = "";
    for (let i = 0; i < index - 1; i++) {
        if (value[i] !== "§") continue;
        const code = value[i + 1].toLowerCase();
        i++;
        if (COLOR_BY_CODE.has(code)) {
            color = `§${code}`;
            formats = "";
        } else if (code === "r") {
            color = "";
            formats = "";
        } else if ("lonmk".includes(code) && !formats.includes(code)) {
            formats += `§${code}`;
        }
    }
    return color + formats || "§r";
}

/**
 * Applies a § code at a selection: a selection is wrapped (the code, the
 * text, then the style that was in effect before it), otherwise the code
 * is inserted at the caret.
 */
export function applyMotdCode(
    value: string,
    start: number,
    end: number,
    code: string,
): { value: string; caret: number } {
    const before = value.slice(0, start);
    const after = value.slice(end);
    if (start === end || code === "r") {
        const inserted = `${before}§${code}`;
        return { value: inserted + after, caret: inserted.length };
    }
    const wrapped = `${before}§${code}${value.slice(start, end)}${styleCodesAt(value, start)}`;
    return { value: wrapped + after, caret: wrapped.length };
}
