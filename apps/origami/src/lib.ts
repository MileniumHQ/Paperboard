export interface Env {
    PACKAGES: KVNamespace;
    PANELS_BUCKET?: R2Bucket;
    BOARDS_BUCKET?: R2Bucket;
    PAPERDL_BUCKET?: R2Bucket;
    AUTH_KEY?: string;
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

    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        if (token === expected) return true;
    }

    const xAuthKey = request.headers.get("X-Auth-Key");
    if (xAuthKey && xAuthKey.trim() === expected) return true;

    const url = new URL(request.url);
    const queryKey =
        url.searchParams.get("key") || url.searchParams.get("auth");
    if (queryKey && queryKey.trim() === expected) return true;

    return false;
}
