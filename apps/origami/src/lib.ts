export interface Env {
    PACKAGES: KVNamespace;
    PANELS_BUCKET?: R2Bucket;
    PAPERDL_BUCKET?: R2Bucket;
    AUTH_KEY?: string;
    // canonical public origin for record URLs (wrangler vars). Record
    // URLs are configuration facts, not reflections of the request.
    PANEL_BASE_URL?: string;
}

export interface PackageMetadata {
    name: string;
    version?: string;
    checksum?: string;
    url?: string;
    downloadUrl?: string;
    [key: string]: unknown;
}

export const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Key",
};

export function jsonResponse(
    data: unknown,
    status = 200,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...CORS_HEADERS,
            ...headers,
        },
    });
}

export function verifyAuth(request: Request, env: Env): boolean {
    const expected = env.AUTH_KEY;
    if (!expected) {
        return false;
    }

    // every caller-supplied secret compares against the expected key in
    // constant time. Portable across runtimes: crypto.subtle has no
    // timingSafeEqual (WebCrypto/workerd/Bun all lack it — calling it
    // throws), so the XOR-accumulation loop below is the implementation,
    // not a fallback. Length difference folds into the accumulator instead
    // of early-returning, so there is no prefix or length oracle.
    const matches = (candidate: string | null | undefined): boolean => {
        if (!candidate) return false;
        const expectedBytes = new TextEncoder().encode(expected);
        const givenBytes = new TextEncoder().encode(candidate);
        const len = Math.max(expectedBytes.length, givenBytes.length);
        let diff = expectedBytes.length ^ givenBytes.length;
        for (let i = 0; i < len; i++) {
            diff |=
                (expectedBytes[i % expectedBytes.length] ?? 0) ^
                (givenBytes[i % givenBytes.length] ?? 0);
        }
        return diff === 0;
    };

    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (matches(token)) return true;
    }

    const xAuthKey = request.headers.get("X-Auth-Key");
    if (matches(xAuthKey)) return true;

    // query-string keys are refused by design: URLs land in edge logs,
    // browser history, and referers. The publisher CLI sends Bearer +
    // X-Auth-Key headers; nothing legitimate authenticates via ?key=.
    return false;
}
