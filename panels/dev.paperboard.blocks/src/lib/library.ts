// What the built-in blocks do that isn't a few lines of arithmetic: web
// requests, time, positions in lists and text. Pure functions the
// interpreter calls; each throws a plain Error the interpreter pins on the
// block that asked.

/** The longest a web request may take, in milliseconds. */
export const WEB_TIMEOUT_MS = 30_000;
/** The most a web request may answer with, in characters. */
export const WEB_MAX_CHARS = 5_000_000;

/**
 * https anywhere, plain http only to this machine: the same rule the
 * Actions panel's web blocks had.
 */
export function webRefusal(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return `"${raw.length > 80 ? `${raw.slice(0, 80)}…` : raw}" isn't a web address`;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol === "http:") {
        return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? null : `Plain http only reaches this computer; use https for ${host}`;
    }
    if (url.protocol !== "https:") return `Only https web addresses work, not ${url.protocol}`;
    return null;
}

export type WebAnswer = "TEXT" | "JSON";

/** Fetches a URL and reads the answer as text or JSON; a non-2xx answer fails. */
export async function web(method: "GET" | "POST", url: string, body: unknown, answer: WebAnswer, signal: AbortSignal): Promise<unknown> {
    const refused = webRefusal(url);
    if (refused) throw new Error(refused);
    const timeout = AbortSignal.timeout(WEB_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            signal: AbortSignal.any([signal, timeout]),
            ...(method === "POST" ? { body: JSON.stringify(body ?? null), headers: { "content-type": "application/json" } } : {}),
        });
    } catch (err) {
        if (signal.aborted) throw new Error("The run was stopped");
        if (timeout.aborted) throw new Error(`${url} didn't answer within ${WEB_TIMEOUT_MS / 1000} seconds`);
        throw new Error(`${method} ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${url} answered ${response.status} ${response.statusText}`.trim());
    if (text.length > WEB_MAX_CHARS) throw new Error(`${url} answered with more than ${WEB_MAX_CHARS} characters`);
    if (answer === "TEXT") return text;
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(`${url} didn't answer with JSON (${err instanceof Error ? err.message : String(err)})`);
    }
}

const UNIT_MS = { SECONDS: 1000, MINUTES: 60_000, HOURS: 3_600_000, DAYS: 86_400_000 } as const;
export type TimeUnit = keyof typeof UNIT_MS;

export function unitMs(unit: string): number {
    const ms = UNIT_MS[unit as TimeUnit];
    if (!ms) throw new Error(`Unknown unit ${unit}`);
    return ms;
}

function dateOf(timestamp: number): Date {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new Error(`${timestamp} isn't a moment in time`);
    return date;
}

/** A timestamp as people read it, in this computer's time zone. */
export function formatTime(timestamp: number, format: string): string {
    const date = dateOf(timestamp);
    switch (format) {
        case "DATE":
            return date.toLocaleDateString(undefined, { dateStyle: "medium" });
        case "TIME":
            return date.toLocaleTimeString(undefined, { timeStyle: "short" });
        case "DATETIME":
            return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        case "WEEKDAY":
            return date.toLocaleDateString(undefined, { weekday: "long" });
        case "ISO":
            return date.toISOString();
    }
    throw new Error(`Unknown format ${format}`);
}

/** One part of a timestamp, in this computer's time zone. */
export function timePart(timestamp: number, part: string): number {
    const date = dateOf(timestamp);
    switch (part) {
        case "YEAR":
            return date.getFullYear();
        case "MONTH":
            return date.getMonth() + 1;
        case "DAY":
            return date.getDate();
        case "HOUR":
            return date.getHours();
        case "MINUTE":
            return date.getMinutes();
        case "SECOND":
            return date.getSeconds();
    }
    throw new Error(`Unknown part ${part}`);
}

/**
 * Where a Blockly position points in something `length` long, 0-based.
 * Blockly counts from 1; "from end" #1 is the last.
 */
export function position(where: string, at: number | undefined, length: number, what: string): number {
    let index: number;
    switch (where) {
        case "FIRST":
            index = 0;
            break;
        case "LAST":
            index = length - 1;
            break;
        case "RANDOM":
            index = Math.floor(Math.random() * length);
            break;
        case "FROM_START":
            index = (at ?? NaN) - 1;
            break;
        case "FROM_END":
            index = length - (at ?? NaN);
            break;
        default:
            throw new Error(`Unknown position ${where}`);
    }
    if (!Number.isInteger(index) || index < 0 || index >= length) {
        throw new Error(length === 0 ? `The ${what} is empty` : `There's no ${where === "FROM_END" ? `#${at} from the end` : `#${at ?? index + 1}`} in a ${what} of ${length}`);
    }
    return index;
}

export function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function modes(nums: number[]): number[] {
    const counts = new Map<number, number>();
    for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
    const most = Math.max(...counts.values());
    return [...counts].filter(([, c]) => c === most).map(([n]) => n);
}

export function standardDeviation(nums: number[]): number {
    const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
}

export function isPrime(n: number): boolean {
    if (!Number.isInteger(n) || n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
}

export function regex(pattern: string): RegExp {
    try {
        return new RegExp(pattern);
    } catch (err) {
        throw new Error(`"${pattern}" isn't a pattern: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export function base64(mode: string, text: string): string {
    if (mode === "ENCODE") {
        let binary = "";
        for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
        return btoa(binary);
    }
    if (mode !== "DECODE") throw new Error(`Unknown mode ${mode}`);
    const clean = text.trim();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new Error("That isn't base64 text");
    const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Error("That base64 isn't text");
    }
}
