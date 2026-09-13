// Typed RPC errors: handlers throw these, the dispatcher and per-handler
// catches map err.code to the wire. Message-text regex matching is
// brittle — one reworded message breaks the mapping — so codes travel on
// the error object, never inside the message.
import { ErrorCode } from "../protocol";

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
