// The field shapes the daemon's RPC is declared in (rpc.ts), on top of
// shape.*. A shape refuses what the daemon could never have served; a few
// also read a value the way the daemon always has (an optional field given
// null is left out, a number given as text is that number), so a peer that
// worked against an older daemon still does. A refusal is an
// InvalidParamsError, which the daemon answers with a typed INVALID_PARAMS.
import { shape, type Fields, type ObjectOf, type ObjectShape, type OptionalShape, type Shape } from "../shape";
import { isPanelId } from "../panelIdentity";

export class InvalidParamsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidParamsError";
    }
}

/** A shape that may also turn the checked value into the one its reader is given. */
type Reading<T> = Shape<T> & { readonly read?: (value: unknown) => T };

const named = (at: string) => (at ? `"${at}"` : "the value");
const problem = (check: (value: unknown) => boolean, why: (at: string, value: unknown) => string) =>
    (value: unknown, at: string) => (check(value) ? null : why(at, value));

// a checked value as its shape reads it
const readChecked = <T>(s: Reading<T>, value: unknown): T => (s.read ? s.read(value) : (value as T));

/** The value as its shape reads it, or a refusal naming where it sits. */
export function readValue<T>(s: Shape<T>, value: unknown, at: string): T {
    const why = s.check(value, at, false);
    if (why) throw new InvalidParamsError(why);
    return readChecked(s, value);
}

/**
 * A value the code it goes to checks itself: a param a service validates
 * (a backup location to add, a port claim), or a daemon record the caller doesn't
 * look inside. Its type is what the wire carries.
 */
export function typed<T>(): Shape<T> {
    return { check: () => null };
}

/** Text of at most `max` characters; empty only when `empty` says so. */
export function text(max = 4096, { empty = false } = {}): Shape<string> {
    return {
        check: (value, at) => {
            if (typeof value !== "string") return `Invalid parameter: ${named(at)} must be a string`;
            if (!empty && !value) return `Missing required parameter: ${at}`;
            if (value.length > max) return `Parameter ${named(at)} exceeds ${max} characters`;
            return null;
        },
    };
}

/** Any text, empty included, of any length. */
export const anyText = (): Shape<string> => text(Infinity, { empty: true });

/** A finite number; a value Number() makes one (as "80") is that number. */
export function numeric(): Shape<number> {
    const reading: Reading<number> = {
        check: problem((v) => v !== null && Number.isFinite(Number(v)), (at) => `Invalid parameter: ${named(at)} must be a number`),
        read: Number,
    };
    return reading;
}

/** Any value, read as true only when it is exactly true. */
export function flag(): OptionalShape<boolean> {
    const reading: Reading<boolean> = { check: () => null, read: (value) => value === true };
    return shape.optional(reading);
}

/** A field that may be left out; null leaves it out too. */
export function opt<T>(inner: Shape<T>): OptionalShape<T> {
    const reading: Reading<T | undefined> = {
        check: (value, at, strict) => (value === null ? null : inner.check(value, at, strict)),
        read: (value) => (value === null ? undefined : readChecked(inner, value)),
    };
    // a field left out is undefined to its reader either way
    return shape.optional(reading as Reading<T>);
}

/** An object's fields, each read by its shape; fields it doesn't name travel on untouched. */
export function object<F extends Fields>(fields: F): ObjectShape<F> {
    const base = shape.object(fields);
    const reading: ObjectShape<F> & Reading<ObjectOf<F>> = {
        ...base,
        read: (value) => {
            const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
            for (const [key, field] of Object.entries(fields)) {
                if (out[key] !== undefined) out[key] = readChecked("optional" in field ? field.optional : field, out[key]);
            }
            return out as ObjectOf<F>;
        },
    };
    return reading;
}

/** A list, each item read by its shape. */
export function list<T>(item: Shape<T>): Shape<T[]> {
    const reading: Reading<T[]> = { ...shape.list(item), read: (value) => (value as unknown[]).map((v) => readChecked(item, v)) };
    return reading;
}

// what a config, package or supervised id may be: it names a file
const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

/** An id that can name a file: letters, digits, ".", "_" and "-", not starting with a dot. */
export function isSafeId(value: unknown): value is string {
    return typeof value === "string" && SAFE_ID_RE.test(value) && !value.startsWith(".");
}

export function id(): Shape<string> {
    return { check: problem(isSafeId, (at, v) => `Invalid ${at}: ${JSON.stringify(v)}`) };
}

export function panelId(): Shape<string> {
    return { check: problem(isPanelId, (at, v) => `Invalid ${at || "panelId"}: ${JSON.stringify(v)}`) };
}

// Panel-relative JSON path for config get/set: workspaces live in the
// panel's own files dir (config.set(data, id, "tabs.json")). Absolute
// paths, traversal and non-JSON names are refused here so the refusal is
// a typed INVALID_PARAMS instead of an engine-level surprise. A colon is
// refused too: it is a Windows drive ("C:/...", absolute there) or an NTFS
// stream, never part of a portable panel-relative name.
const normalPath = (raw: string) => raw.trim().replace(/\\/g, "/");
export function configPath(): Shape<string> {
    const bounded = text(256);
    const reading: Reading<string> = {
        check: (value, at) => {
            const why = bounded.check(value, at, false);
            if (why) return why;
            const normalized = normalPath(value as string);
            const bad = !normalized.endsWith(".json") || normalized.startsWith("/") || normalized.includes(":") ||
                normalized.split("/").some((segment) => segment === "" || segment === "..");
            return bad ? `Invalid config path: ${JSON.stringify(value)}` : null;
        },
        read: (value) => normalPath(value as string),
    };
    return reading;
}

// child-process environment shape: a flat string map, bounded. Non-string
// values are refused, not coerced — a caller passing objects/arrays is a
// bug, and silent coercion would plant "[object Object]" in a child env.
export function envMap(): Shape<Record<string, string>> {
    return {
        check: (value, at) => {
            if (typeof value !== "object" || value === null || Array.isArray(value)) return `Invalid parameter: ${at} must be a string map`;
            const entries = Object.entries(value);
            if (entries.length > 128) return `Invalid parameter: ${at} exceeds 128 entries`;
            for (const [k, v] of entries) {
                if (typeof v !== "string") return `Invalid parameter: ${at}["${k}"] must be a string`;
                if (k.length > 256 || v.length > 8192) return `Invalid parameter: ${at}["${k}"] exceeds size limits`;
            }
            return null;
        },
    };
}
