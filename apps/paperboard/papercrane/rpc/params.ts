// One boundary shape for every RPC handler. Each assert throws
// InvalidParamsError, which the WS dispatcher maps to a typed
// INVALID_PARAMS reply — handlers never pass `params: any` fields
// downstream unchecked, and callers always get a typed refusal instead
// of an INTERNAL crash for a malformed call.
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

export function assertStr(
    value: unknown,
    name: string,
    maxLen = 4096,
    allowEmpty = false,
): string {
    if (typeof value !== "string" || (!allowEmpty && !value)) {
        throw new InvalidParamsError(`Missing required parameter: ${name}`);
    }
    if (value.length > maxLen) {
        throw new InvalidParamsError(
            `Parameter "${name}" exceeds ${maxLen} characters`,
        );
    }
    return value;
}

export function assertOptStr(
    value: unknown,
    name: string,
    maxLen = 4096,
): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") {
        throw new InvalidParamsError(`Invalid parameter: ${name} must be a string`);
    }
    if (value.length > maxLen) {
        throw new InvalidParamsError(
            `Parameter "${name}" exceeds ${maxLen} characters`,
        );
    }
    return value;
}

// sanitizeId-validated identity (panels, configs, supervised ids)
export function assertId(value: unknown, name = "id"): string {
    const clean = sanitizeId(typeof value === "string" ? value : null);
    if (!clean) {
        throw new InvalidParamsError(
            `Invalid ${name}: ${JSON.stringify(value)}`,
        );
    }
    return clean;
}

export function assertPanelId(value: unknown): string {
    return assertId(value, "panelId");
}

export function assertNum(
    value: unknown,
    name: string,
    fallback?: number,
): number {
    if (value === undefined || value === null) {
        if (fallback !== undefined) return fallback;
        throw new InvalidParamsError(`Missing required parameter: ${name}`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new InvalidParamsError(`Invalid parameter: ${name} must be a number`);
    }
    return n;
}

// child-process environment shape: a flat string map, bounded. Non-string
// values are refused, not coerced — a caller passing objects/arrays is a
// bug, and silent coercion would plant "[object Object]" in a child env.
export function assertEnvMap(value: unknown, name: string): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new InvalidParamsError(`Invalid parameter: ${name} must be a string map`);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 128) {
        throw new InvalidParamsError(`Invalid parameter: ${name} exceeds 128 entries`);
    }
    const out: Record<string, string> = {};
    for (const [k, v] of entries) {
        if (typeof v !== "string") {
            throw new InvalidParamsError(`Invalid parameter: ${name}["${k}"] must be a string`);
        }
        if (k.length > 256 || v.length > 8192) {
            throw new InvalidParamsError(`Invalid parameter: ${name}["${k}"] exceeds size limits`);
        }
        out[k] = v;
    }
    return out;
}
