export interface Env {
    PACKAGES: KVNamespace;
    PANELS_BUCKET?: R2Bucket;
    PAPERDL_BUCKET?: R2Bucket;
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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


