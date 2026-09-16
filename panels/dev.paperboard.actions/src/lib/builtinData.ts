// Pure implementations behind the data-ish builtin actions (text, JSON,
// lists, timers). Kept free of paperapi so they are cheap to test and the
// runtime handlers stay thin.

// flow text can come from anywhere: bound every string operation so one
// step cannot hang the flow on a hostile payload.
export const MAX_TEXT_INPUT = 100_000;
export const MAX_REGEX_PATTERN = 200;
export const MAX_TRUNCATE_LENGTH = 10_000;

function requireText(value: unknown, name: string): string {
    const text = value === undefined || value === null ? "" : String(value);
    if (text.length > MAX_TEXT_INPUT) {
        throw new Error(`${name} exceeds ${MAX_TEXT_INPUT} characters`);
    }
    return text;
}

function requirePattern(value: unknown): RegExp {
    const pattern = String(value ?? "").trim();
    if (!pattern) throw new Error("A regular expression pattern is required");
    if (pattern.length > MAX_REGEX_PATTERN) {
        throw new Error(`Pattern exceeds ${MAX_REGEX_PATTERN} characters`);
    }
    try {
        return new RegExp(pattern);
    } catch (err) {
        throw new Error(
            `Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

export function splitText(value: unknown, separator: unknown): string[] {
    const text = requireText(value, "Text");
    const sep = separator === undefined || separator === null ? "" : String(separator);
    if (sep === "") return [...text];
    return text.split(sep);
}

export function regexMatch(value: unknown, pattern: unknown): boolean {
    return requirePattern(pattern).test(requireText(value, "Text"));
}

/** First match (or capture group when `group` is set), null when no match. */
export function regexExtract(
    value: unknown,
    pattern: unknown,
    group: unknown,
): string | null {
    const match = requireText(value, "Text").match(requirePattern(pattern));
    if (!match) return null;
    const index = group === undefined || group === null || group === "" ? 0 : Number(group);
    if (!Number.isInteger(index) || index < 0 || index >= match.length) {
        throw new Error(`Capture group ${group} does not exist in this pattern`);
    }
    return match[index] ?? null;
}

export function truncateText(value: unknown, length: unknown, ellipsis: unknown): string {
    const text = requireText(value, "Text");
    const size = Math.max(0, Math.min(MAX_TRUNCATE_LENGTH, Math.trunc(Number(length ?? 80))));
    if (!Number.isFinite(size)) throw new Error("Length must be a number");
    if (text.length <= size) return text;
    const suffix = ellipsis === undefined || ellipsis === null ? "…" : String(ellipsis);
    if (suffix.length >= size) return suffix.slice(0, size);
    return text.slice(0, size - suffix.length) + suffix;
}

export function padText(
    value: unknown,
    length: unknown,
    side: unknown,
    fill: unknown,
): string {
    const text = requireText(value, "Text");
    const size = Math.trunc(Number(length ?? 0));
    if (!Number.isFinite(size) || size < 0) throw new Error("Length must be zero or more");
    const filler = String(fill ?? " ").slice(0, 64) || " ";
    if (text.length >= size) return text;
    const needed = size - text.length;
    const pad = filler.repeat(Math.ceil(needed / filler.length)).slice(0, needed);
    return side === "start" ? pad + text : text + pad;
}

/** Parse a number out of a string; "12px" trims to 12, "abc" refuses. */
export function toNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = requireText(value, "Text").trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
        throw new Error(`"${text.slice(0, 40)}" does not contain a number`);
    }
    return Number(match[0]);
}

export function base64Encode(value: unknown): string {
    const text = requireText(value, "Text");
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function base64Decode(value: unknown): string {
    const text = requireText(value, "Text").trim();
    try {
        const binary = atob(text);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch (err) {
        throw new Error(
            `Not valid base64: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

export function parseJson(value: unknown): unknown {
    const text = requireText(value, "Text").trim();
    if (!text) throw new Error("No JSON to parse");
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(
            `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

export function stringifyJson(value: unknown, pretty: unknown): string {
    const indent = pretty === false || pretty === "false" ? undefined : 2;
    const out = JSON.stringify(value ?? null, null, indent);
    return out === undefined ? "null" : out;
}

/** Read `a.b.0.c` from an object or array; refuses traversal-shaped keys. */
export function getField(value: unknown, path: unknown): unknown {
    const raw = String(path ?? "").trim();
    if (!raw) throw new Error("A field path is required");
    let current: any = value;
    for (const segment of raw.split(".")) {
        if (!segment || segment === "__proto__" || segment === "prototype" || segment === "constructor") {
            throw new Error(`Invalid field path segment: ${JSON.stringify(segment)}`);
        }
        if (current === null || current === undefined) return null;
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) return null;
            current = current[index];
            continue;
        }
        if (typeof current !== "object") return null;
        current = (current as Record<string, unknown>)[segment];
    }
    return current === undefined ? null : current;
}

export function listLength(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (typeof value === "string") return value.length;
    if (value && typeof value === "object") return Object.keys(value as object).length;
    return 0;
}

/** Value at `index`; negative indexes count from the end. */
export function pickFromList(value: unknown, index: unknown): unknown {
    if (!Array.isArray(value)) throw new Error("Pick from List needs a list");
    const raw = Number(index ?? 0);
    if (!Number.isFinite(raw)) throw new Error("Index must be a number");
    const at = Math.trunc(raw);
    const resolved = at < 0 ? value.length + at : at;
    if (resolved < 0 || resolved >= value.length) {
        throw new Error(`Index ${at} is outside the list (${value.length} items)`);
    }
    return value[resolved];
}

/** Shared truthiness for Wait Until: strings "false"/"0"/"" are false too. */
export function isTruthyFlowValue(value: unknown): boolean {
    if (typeof value === "string") {
        const clean = value.trim().toLowerCase();
        return clean !== "" && clean !== "false" && clean !== "0" && clean !== "no";
    }
    return Boolean(value);
}

/** Elapsed milliseconds from a timestamp (epoch ms or ISO date). */
export function measureDuration(since: unknown): number {
    let start: number;
    if (typeof since === "number" && Number.isFinite(since)) {
        start = since;
    } else {
        const raw = String(since ?? "").trim();
        const asNumber = Number(raw);
        start = raw !== "" && Number.isFinite(asNumber) ? asNumber : Date.parse(raw);
    }
    if (!Number.isFinite(start)) {
        throw new Error("Measure Duration needs a timestamp (epoch milliseconds or ISO date)");
    }
    return Math.max(0, Date.now() - start);
}
