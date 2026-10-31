// PalWorldSettings.ini holds every setting on one line:
//   [/Script/Pal.PalGameWorldSettings]
//   OptionSettings=(Difficulty=None,ExpRate=1.000000,ServerName="My server",...)
// Values are Unreal property text: quoted strings, True/False, numbers with
// six decimals for floats, bare enum names and parenthesised tuples such as
// CrossplayPlatforms=(Steam,Xbox). Parsing keeps every entry in order with its
// raw text, so a write changes only the keys it sets.

export const SECTION = "[/Script/Pal.PalGameWorldSettings]";

export type IniEntry = { key: string; raw: string };

/** Splits on commas outside quotes and parentheses. */
function splitTopLevel(body: string): string[] {
    const parts: string[] = [];
    let current = "";
    let quoted = false;
    let depth = 0;
    for (const char of body) {
        if (char === '"') quoted = !quoted;
        else if (!quoted && char === "(") depth++;
        else if (!quoted && char === ")") depth--;
        if (char === "," && !quoted && depth === 0) {
            parts.push(current);
            current = "";
        } else current += char;
    }
    if (quoted || depth !== 0) throw new Error("PalWorldSettings.ini has an unclosed quote or parenthesis in OptionSettings");
    if (current) parts.push(current);
    return parts;
}

/** The OptionSettings entries, in file order. Throws when the file has none. */
export function parseOptionSettings(text: string): IniEntry[] {
    const line = text.split(/\r?\n/).find((l) => l.startsWith("OptionSettings="));
    if (!line) throw new Error("PalWorldSettings.ini has no OptionSettings line");
    const value = line.slice("OptionSettings=".length).trim();
    if (!value.startsWith("(") || !value.endsWith(")")) throw new Error("PalWorldSettings.ini's OptionSettings is not wrapped in parentheses");
    return splitTopLevel(value.slice(1, -1)).map((part) => {
        const at = part.indexOf("=");
        if (at <= 0) throw new Error(`PalWorldSettings.ini has an OptionSettings entry without a value: ${part}`);
        return { key: part.slice(0, at).trim(), raw: part.slice(at + 1) };
    });
}

/** The file with these entries; comment lines and other sections of `previous` are kept. */
export function writeOptionSettings(previous: string, entries: readonly IniEntry[]): string {
    const line = `OptionSettings=(${entries.map((e) => `${e.key}=${e.raw}`).join(",")})`;
    const lines = previous.split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith("OptionSettings="));
    if (at >= 0) lines[at] = line;
    else {
        const section = lines.findIndex((l) => l.trim() === SECTION);
        if (section >= 0) lines.splice(section + 1, 0, line);
        else lines.push(SECTION, line);
    }
    return lines.join("\n").replace(/\n*$/, "\n");
}

export type IniType = "string" | "bool" | "float" | "int" | "enum";

/** The value as JSON: strings unquoted, booleans and numbers typed. */
export function decode(raw: string, type: IniType, key: string): string | number | boolean {
    const value = raw.trim();
    switch (type) {
        case "string":
            if (value === "") return "";
            if (!/^".*"$/.test(value)) throw new Error(`PalWorldSettings.ini: ${key} is not a quoted string`);
            return value.slice(1, -1);
        case "bool":
            if (/^true$/i.test(value)) return true;
            if (/^false$/i.test(value)) return false;
            throw new Error(`PalWorldSettings.ini: ${key} is not True or False`);
        case "float":
        case "int": {
            const number = Number(value);
            if (value === "" || !Number.isFinite(number)) throw new Error(`PalWorldSettings.ini: ${key} is not a number`);
            return number;
        }
        case "enum":
            if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`PalWorldSettings.ini: ${key} is not a setting name`);
            return value;
    }
}

/** A JSON value as Unreal property text. Strings may not hold quotes or backslashes. */
export function encode(value: unknown, type: IniType, key: string): string {
    switch (type) {
        case "string":
            if (typeof value !== "string" || /["\\\r\n]/.test(value)) throw new Error(`${key} can't hold quotes, backslashes or line breaks`);
            return `"${value}"`;
        case "bool":
            if (typeof value !== "boolean") throw new Error(`${key} must be on or off`);
            return value ? "True" : "False";
        case "float":
            if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
            return value.toFixed(6);
        case "int":
            if (!Number.isInteger(value)) throw new Error(`${key} must be a whole number`);
            return String(value);
        case "enum":
            if (typeof value !== "string" || !/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`${key} must be a setting name`);
            return value;
    }
}
