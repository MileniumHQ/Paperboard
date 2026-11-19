// Typed RPC errors: handlers throw these, the dispatcher and per-handler
// catches map err.code to the wire. Message-text regex matching is
// brittle — one reworded message breaks the mapping — so codes travel on
// the error object, never inside the message.
import { InvalidParamsError } from "@mileniumhq/paperapi/protocol";
import { ErrorCode } from "../core/protocol";

export class RpcError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "RpcError";
        this.code = code;
    }
}

export function forbidden(what: string): RpcError {
    return new RpcError(ErrorCode.FORBIDDEN, what);
}

export function invalidParams(what: string): RpcError {
    return new RpcError(ErrorCode.INVALID_PARAMS, what);
}

/**
 * An answer given as it is: its message without the "Request failed:"
 * prefix, and only the code it names (none for a plain refusal).
 */
export class Refusal extends Error {
    readonly code: string | undefined;
    constructor(message: string, code?: string) {
        super(message);
        this.name = "Refusal";
        this.code = code;
    }
}

// error → wire code mapping both the dispatcher and per-handler catches use.
// InvalidParamsError (a call's params refused by their shape) maps by type;
// RpcError and service errors (e.g. SecretError) map by their carried code.
export function rpcErrorCode(err: unknown): string {
    if (err instanceof InvalidParamsError) return ErrorCode.INVALID_PARAMS;
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === "string" && (Object.values(ErrorCode) as string[]).includes(code)) {
        return code;
    }
    return ErrorCode.INTERNAL;
}
