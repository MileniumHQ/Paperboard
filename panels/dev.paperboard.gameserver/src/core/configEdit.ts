import { isMap, isScalar, parseDocument } from "yaml";

// Reads and edits one scalar in a loader's config file without rewriting
// the rest of it: comments, ordering and indentation stay as the software
// wrote them. Only keys that already exist are edited; a key the file does
// not have is reported missing, never added (a version without the key
// would not read it). Pure: text in, text out.

export type ScalarText = string;

// ─── YAML (Paper, Spigot, Bukkit) ─────────────────────────────────────

export function readYamlValue(text: string, path: string[]): ScalarText | null {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new Error(`Could not parse the file: ${doc.errors[0]!.message}`);
    const node = doc.getIn(path, true);
    if (!isScalar(node)) return null;
    const value = node.value;
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    if (typeof value === "string") return value;
    return null;
}

/**
 * `value` is validated text; it is written with the type the file already
 * uses for the key. The library only locates the value: the new text is
 * spliced into the original string at that node's source range, because
 * re-serializing the document re-indents lists and trims comment lines
 * elsewhere in the file.
 */
export function setYamlValue(text: string, path: string[], value: ScalarText): string {
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new Error(`Could not parse the file: ${doc.errors[0]!.message}`);
    const parent = doc.getIn(path.slice(0, -1), true);
    const node = doc.getIn(path, true);
    if (!isMap(parent) || !isScalar(node) || !node.range) {
        throw new Error(`The file has no ${path.join(".")} setting`);
    }
    let literal: string;
    if (typeof node.value === "boolean") literal = value === "true" ? "true" : "false";
    else if (typeof node.value === "number") literal = String(Number(value));
    // plain text only when it reads back as the same string
    else literal = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)
        ? value
        : JSON.stringify(value);
    const [start, valueEnd] = node.range;
    return text.slice(0, start) + literal + text.slice(valueEnd);
}

// ─── TOML (NeoForge, Forge) ───────────────────────────────────────────

const TOML_SECTION = /^\s*\[([^\]]+)\]\s*$/;
const TOML_PAIR = /^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.*?)\s*$/;

function findTomlLine(lines: string[], section: string, key: string): number {
    let current = "";
    for (let i = 0; i < lines.length; i++) {
        const header = lines[i]!.match(TOML_SECTION);
        if (header) {
            current = header[1]!.trim();
            continue;
        }
        const pair = lines[i]!.match(TOML_PAIR);
        if (pair && current === section && pair[2] === key) return i;
    }
    return -1;
}

export function readTomlValue(text: string, section: string, key: string): ScalarText | null {
    const lines = text.split("\n");
    const index = findTomlLine(lines, section, key);
    if (index < 0) return null;
    const raw = lines[index]!.match(TOML_PAIR)![4]!;
    const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
    return quoted ? quoted[1]! : raw;
}

export function setTomlValue(text: string, section: string, key: string, value: ScalarText): string {
    const lines = text.split("\n");
    const index = findTomlLine(lines, section, key);
    if (index < 0) throw new Error(`The file has no ${section ? `${section}.` : ""}${key} setting`);
    const [, indent, name, equals, raw] = lines[index]!.match(TOML_PAIR)!;
    // keep a string a string; booleans and numbers stay bare
    const literal = /^".*"$/.test(raw!) ? JSON.stringify(value) : value;
    // a CRLF file (Windows) keeps its line endings
    const eol = lines[index]!.endsWith("\r") ? "\r" : "";
    lines[index] = `${indent}${name}${equals}${literal}${eol}`;
    return lines.join("\n");
}

// ─── Forge 1.12 .cfg ──────────────────────────────────────────────────
//
//   general {
//       # comment
//       B:removeErroringEntities=false
//   }

const CFG_CATEGORY_OPEN = /^\s*([A-Za-z0-9_ ."-]+?)\s*\{\s*$/;
const CFG_CATEGORY_CLOSE = /^\s*\}\s*$/;
const CFG_PAIR = /^(\s*)([BIDS]):([A-Za-z0-9_]+)=(.*?)\s*$/;

function findCfgLine(lines: string[], category: string, key: string): number {
    const stack: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const open = line.match(CFG_CATEGORY_OPEN);
        if (open) {
            stack.push(open[1]!.replace(/^"|"$/g, ""));
            continue;
        }
        if (CFG_CATEGORY_CLOSE.test(line)) {
            stack.pop();
            continue;
        }
        const pair = line.match(CFG_PAIR);
        if (pair && stack.length === 1 && stack[0] === category && pair[3] === key) return i;
    }
    return -1;
}

export function readCfgValue(text: string, category: string, key: string): ScalarText | null {
    const lines = text.split("\n");
    const index = findCfgLine(lines, category, key);
    return index < 0 ? null : lines[index]!.match(CFG_PAIR)![4]!;
}

export function setCfgValue(text: string, category: string, key: string, value: ScalarText): string {
    const lines = text.split("\n");
    const index = findCfgLine(lines, category, key);
    if (index < 0) throw new Error(`The file has no ${category}.${key} setting`);
    const [, indent, type] = lines[index]!.match(CFG_PAIR)!;
    const eol = lines[index]!.endsWith("\r") ? "\r" : "";
    lines[index] = `${indent}${type}:${key}=${value}${eol}`;
    return lines.join("\n");
}
