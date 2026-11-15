// The field shapes daemon RPC params are declared in (rpc/contract.ts), on
// top of PaperAPI's shape.*. A shape refuses what the daemon could never
// have served; a few also read a value the way the daemon always has (an
// optional field given null is left out, a number given as text is that
// number), so a peer that worked against an older daemon still does.
// A refusal is an InvalidParamsError, which the dispatcher answers with a
// typed INVALID_PARAMS.
import { shape, type Fields, type ObjectOf, type ObjectShape, type OptionalShape, type Shape } from "@mileniumhq/paperapi";
import { isPanelId } from "@mileniumhq/paperapi/panelIdentity";
import { sanitizeId } from "../storage";
import { ErrorCode } from "../protocol";

export class InvalidParamsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidParamsError";
    }
}

// error → wire code mapping both the dispatcher and per-handler catches use.
// InvalidParamsError maps by type; RpcError and service errors (e.g.
// SecretError) map by their carried code. Message-text regex matching is
// banned here — codes travel on the error, never inside the message.
export function rpcErrorCode(err: unknown): string {
    if (err instanceof InvalidParamsError) return ErrorCode.INVALID_PARAMS;
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === "string" && (Object.values(ErrorCode) as string[]).includes(code)) {
        return code;
    }
    return ErrorCode.INTERNAL;
}

/** A shape that may also turn the checked value into the one its handler is given. */
type Reading<T> = Shape<T> & { readonly read?: (value: unknown) => T };

const named = (at: string) => (at ? `"${at}"` : "the value");
const problem = (check: (value: unknown) => boolean, why: (at: string, value: unknown) => string) =>
    (value: unknown, at: string) => (check(value) ? null : why(at, value));

// a checked value as its shape reads it
const readChecked = <T>(s: Shape<T>, value: unknown): T => {
    const { read } = s as Reading<T>;
    return read ? read(value) : (value as T);
};

/** The value as its shape reads it, or a refusal naming where it sits. */
export function readValue<T>(s: Shape<T>, value: unknown, at: string): T {
    const why = s.check(value, at, false);
    if (why) throw new InvalidParamsError(why);
    return readChecked(s, value);
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

/** A finite number; a value Number() makes one (as "80") is that number. */
export function numeric(): Shape<number> {
    return {
        check: problem((v) => v !== null && Number.isFinite(Number(v)), (at) => `Invalid parameter: ${named(at)} must be a number`),
        read: Number,
    } as Reading<number>;
}

/** Any value, read as true only when it is exactly true. */
export function flag(): OptionalShape<boolean> {
    return shape.optional({ check: () => null, read: (value: unknown) => value === true } as Reading<boolean>);
}

/** A field that may be left out; null leaves it out too. */
export function opt<T>(inner: Shape<T>): OptionalShape<T> {
    return shape.optional({
        check: (value, at, strict) => (value === null ? null : inner.check(value, at, strict)),
        read: (value: unknown) => (value === null ? undefined : readChecked(inner, value)),
    } as Reading<T>);
}

/** An object's fields, each read by its shape; fields it doesn't name travel on untouched. */
export function object<F extends Fields>(fields: F): ObjectShape<F> {
    const base = shape.object(fields);
    return {
        ...base,
        read: (value: unknown) => {
            const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
            for (const [key, field] of Object.entries(fields)) {
                if (out[key] !== undefined) out[key] = readChecked("optional" in field ? field.optional : field, out[key]);
            }
            return out as ObjectOf<F>;
        },
    } as ObjectShape<F>;
}

/** A list, each item read by its shape. */
export function list<T>(item: Shape<T>): Shape<T[]> {
    return { ...shape.list(item), read: (value: unknown) => (value as unknown[]).map((v) => readChecked(item, v)) } as Reading<T[]>;
}

/** An id sanitizeId keeps (configs, packages, supervised ids). */
export function id(): Shape<string> {
    return { check: problem((v) => sanitizeId(typeof v === "string" ? v : null) !== null, (at, v) => `Invalid ${at}: ${JSON.stringify(v)}`) };
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
    return {
        check: (value, at) => {
            const why = bounded.check(value, at, false);
            if (why) return why;
            const normalized = normalPath(value as string);
            const bad = !normalized.endsWith(".json") || normalized.startsWith("/") || normalized.includes(":") ||
                normalized.split("/").some((segment) => segment === "" || segment === "..");
            return bad ? `Invalid config path: ${JSON.stringify(value)}` : null;
        },
        read: (value: unknown) => normalPath(value as string),
    } as Reading<string>;
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
