// wire protocol constants shared by paperapi + papercrane.
// kept intentionally tiny: version + error codes only

export const PROTOCOL_VERSION = 2;

// every WS error carries a machine-readable code next to the human string;
// the client maps it to err.code. keep stable — panels nest these values
export const ErrorCode = {
    AUTH_REQUIRED: "AUTH_REQUIRED",
    BAD_PROTOCOL: "BAD_PROTOCOL",
    NOT_FOUND: "NOT_FOUND",
    INVALID_PARAMS: "INVALID_PARAMS",
    FORBIDDEN: "FORBIDDEN",
    CONFLICT: "CONFLICT",
    INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
