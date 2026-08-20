import { updateJavaPackages } from "./updateJava";
import {
    getBoardsIndex,
    getBoard,
    saveBoard,
    deleteBoard,
    type BoardRecord,
} from "./boards";

export interface Env {
    PACKAGES: KVNamespace;
    BOARDS_BUCKET?: R2Bucket;
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

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Key",
};

function jsonResponse(
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

function verifyAuth(request: Request, env: Env): boolean {
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

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: CORS_HEADERS,
            });
        }

        const url = new URL(request.url);
        const pathname = url.pathname;

        try {
            if (pathname === "/" || pathname === "/health") {
                return jsonResponse({
                    service: "Origami Package & Board Registry",
                    status: "healthy",
                    endpoints: [
                        "/package/:name.json",
                        "/package/index.json",
                        "/boards/index.json",
                        "/board/:id.json",
                        "/board/:id/download",
                        "/board/publish",
                        "/update/java",
                    ],
                });
            }

            if (
                pathname === "/update/java" ||
                pathname === "/update/java/" ||
                pathname.startsWith("/update/java/")
            ) {
                if (!verifyAuth(request, env)) {
                    return jsonResponse(
                        {
                            error: "Unauthorized",
                            message:
                                "Valid auth key required (via Authorization header, X-Auth-Key, or ?key= query parameter)",
                        },
                        401,
                    );
                }

                if (!env.PACKAGES) {
                    return jsonResponse(
                        { error: "PACKAGES KV binding not configured" },
                        500,
                    );
                }

                let targetVersion: string | undefined = undefined;
                const pathParts = pathname.split("/").filter(Boolean);
                if (pathParts.length >= 3 && pathParts[2]) {
                    targetVersion = pathParts[2].replace(/^java-?/, "");
                } else if (url.searchParams.get("version")) {
                    targetVersion = url.searchParams
                        .get("version")
                        ?.replace(/^java-?/, "");
                }

                const result = await updateJavaPackages(
                    env.PACKAGES,
                    targetVersion,
                );
                return jsonResponse(result);
            }

            if (
                pathname === "/boards/index.json" ||
                pathname === "/boards" ||
                pathname === "/boards/"
            ) {
                if (!env.PACKAGES) {
                    return jsonResponse(
                        { error: "PACKAGES KV binding not configured" },
                        500,
                    );
                }

                const index = await getBoardsIndex(env.PACKAGES);
                return jsonResponse(index);
            }

            if (
                pathname === "/board/publish" ||
                pathname === "/boards/publish"
            ) {
                if (request.method !== "POST") {
                    return jsonResponse({ error: "Method Not Allowed" }, 405);
                }

                if (!verifyAuth(request, env)) {
                    return jsonResponse({ error: "Unauthorized" }, 401);
                }

                if (!env.PACKAGES) {
                    return jsonResponse(
                        { error: "PACKAGES KV binding not configured" },
                        500,
                    );
                }

                const contentType = request.headers.get("content-type") || "";

                if (contentType.includes("multipart/form-data")) {
                    const formData = await request.formData();
                    const archiveFile = formData.get("archive") as File | null;
                    const metadataRaw = formData.get("metadata") as
                        | string
                        | null;

                    if (!archiveFile || !metadataRaw) {
                        return jsonResponse(
                            {
                                error: "Missing 'archive' file or 'metadata' field in formData",
                            },
                            400,
                        );
                    }

                    let metadata: Partial<BoardRecord>;
                    try {
                        metadata = JSON.parse(metadataRaw);
                    } catch {
                        return jsonResponse(
                            { error: "Invalid metadata JSON" },
                            400,
                        );
                    }

                    if (!metadata.id || !metadata.name || !metadata.version) {
                        return jsonResponse(
                            {
                                error: "Metadata must include 'id', 'name', and 'version'",
                            },
                            400,
                        );
                    }

                    const archiveBuffer = await archiveFile.arrayBuffer();
                    const sizeBytes = archiveBuffer.byteLength;

                    const hashBuffer = await crypto.subtle.digest(
                        "SHA-256",
                        archiveBuffer,
                    );
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const sha256 = hashArray
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("");

                    const archiveKey = `boards/${metadata.id}/${metadata.id}-${metadata.version}.tar.gz`;

                    if (env.BOARDS_BUCKET) {
                        await env.BOARDS_BUCKET.put(archiveKey, archiveBuffer, {
                            httpMetadata: {
                                contentType: "application/gzip",
                            },
                            customMetadata: {
                                id: metadata.id,
                                version: metadata.version,
                                sha256,
                            },
                        });
                    }

                    const iconFile = formData.get("icon") as File | null;
                    let iconUrl: string | undefined = undefined;
                    if (iconFile && env.BOARDS_BUCKET) {
                        const iconExt = iconFile.name.endsWith(".svg")
                            ? "svg"
                            : iconFile.name.endsWith(".webp")
                              ? "webp"
                              : "png";
                        const iconKey = `boards/${metadata.id}/icon.${iconExt}`;
                        const iconBuffer = await iconFile.arrayBuffer();
                        await env.BOARDS_BUCKET.put(iconKey, iconBuffer, {
                            httpMetadata: {
                                contentType:
                                    iconFile.type ||
                                    (iconExt === "svg"
                                        ? "image/svg+xml"
                                        : "image/png"),
                                cacheControl:
                                    "public, max-age=31536000, immutable",
                            },
                        });
                        iconUrl = `${url.origin}/board/${metadata.id}/icon`;
                    }

                    const record: BoardRecord = {
                        id: metadata.id,
                        name: metadata.name,
                        version: metadata.version,
                        description: metadata.description,
                        icon: metadata.icon,
                        iconUrl,
                        archiveKey,
                        sha256,
                        sizeBytes,
                        downloadUrl: `${url.origin}/board/${metadata.id}/download`,
                        updatedAt: new Date().toISOString(),
                        manifest: metadata.manifest || (metadata as any),
                    };

                    await saveBoard(env.PACKAGES, record);
                    return jsonResponse({ success: true, board: record });
                }

                const body = (await request.json()) as Partial<BoardRecord>;
                if (!body.id || !body.name || !body.version) {
                    return jsonResponse(
                        {
                            error: "Metadata must include 'id', 'name', and 'version'",
                        },
                        400,
                    );
                }

                const record: BoardRecord = {
                    id: body.id,
                    name: body.name,
                    version: body.version,
                    description: body.description,
                    icon: body.icon,
                    downloadUrl:
                        body.downloadUrl ||
                        `${url.origin}/board/${body.id}/download`,
                    sha256: body.sha256,
                    sizeBytes: body.sizeBytes,
                    updatedAt: new Date().toISOString(),
                    manifest: body.manifest || (body as any),
                };

                await saveBoard(env.PACKAGES, record);
                return jsonResponse({ success: true, board: record });
            }

            const downloadMatch = pathname.match(
                /^\/board\/([a-zA-Z0-9_\-\.]+)\/download$/,
            );
            if (downloadMatch && downloadMatch[1]) {
                const boardId = downloadMatch[1];
                const record = await getBoard(env.PACKAGES, boardId);

                if (!record) {
                    return jsonResponse({ error: "Board not found" }, 404);
                }

                if (env.BOARDS_BUCKET && record.archiveKey) {
                    const object = await env.BOARDS_BUCKET.get(
                        record.archiveKey,
                    );
                    if (object) {
                        const headers = new Headers();
                        object.writeHttpMetadata(headers);
                        headers.set("etag", object.httpEtag);
                        headers.set("Content-Type", "application/gzip");
                        headers.set(
                            "Content-Disposition",
                            `attachment; filename="${record.id}-${record.version}.tar.gz"`,
                        );
                        headers.set("Access-Control-Allow-Origin", "*");
                        return new Response(object.body, { headers });
                    }
                }

                if (record.downloadUrl && record.downloadUrl !== request.url) {
                    return Response.redirect(record.downloadUrl, 302);
                }

                return jsonResponse(
                    { error: "Archive file not found in storage" },
                    404,
                );
            }

            // Board icon route: GET /board/:id/icon
            const iconMatch = pathname.match(
                /^\/board\/([a-zA-Z0-9_\-\.]+)\/icon(?:\.(png|svg|webp))?$/,
            );
            if (iconMatch && iconMatch[1] && request.method === "GET") {
                const boardId = iconMatch[1];
                if (env.BOARDS_BUCKET) {
                    for (const ext of ["png", "svg", "webp"]) {
                        const object = await env.BOARDS_BUCKET.get(
                            `boards/${boardId}/icon.${ext}`,
                        );
                        if (object) {
                            const headers = new Headers();
                            object.writeHttpMetadata(headers);
                            headers.set("Cache-Control", "public, max-age=86400");
                            headers.set("Access-Control-Allow-Origin", "*");
                            return new Response(object.body, { headers });
                        }
                    }
                }
                return jsonResponse({ error: "Icon not found" }, 404);
            }

            const boardMatch = pathname.match(
                /^\/board\/([a-zA-Z0-9_\-\.]+)(?:\.json)?$/,
            );
            if (boardMatch && boardMatch[1] && request.method === "GET") {
                const boardId = boardMatch[1];
                const record = await getBoard(env.PACKAGES, boardId);

                if (!record) {
                    return jsonResponse({ error: "Board not found" }, 404);
                }

                return jsonResponse(record);
            }

            if (boardMatch && boardMatch[1] && request.method === "DELETE") {
                if (!verifyAuth(request, env)) {
                    return jsonResponse({ error: "Unauthorized" }, 401);
                }

                const boardId = boardMatch[1];
                const deleted = await deleteBoard(
                    env.PACKAGES,
                    env.BOARDS_BUCKET,
                    boardId,
                );

                if (!deleted) {
                    return jsonResponse({ error: "Board not found" }, 404);
                }

                return jsonResponse({ success: true, deletedId: boardId });
            }

            if (request.method !== "GET" && request.method !== "HEAD") {
                return jsonResponse({ error: "Method Not Allowed" }, 405);
            }

            if (
                pathname === "/package/index.json" ||
                pathname === "/packages/index.json" ||
                pathname === "/package/index"
            ) {
                if (!env.PACKAGES) {
                    return jsonResponse(
                        { error: "PACKAGES KV binding not configured" },
                        500,
                    );
                }

                const packageIndex: Record<string, unknown> = {};
                let cursor: string | undefined = undefined;

                do {
                    const listResult: KVNamespaceListResult<unknown> =
                        await env.PACKAGES.list({
                            cursor,
                        });

                    const keys = listResult.keys
                        .map((k) => k.name)
                        .filter(
                            (name) =>
                                !name.startsWith("board:") &&
                                !name.startsWith("boards:"),
                        );

                    const values = await Promise.all(
                        keys.map(async (key) => {
                            try {
                                const val = await env.PACKAGES.get(key, {
                                    type: "json",
                                });
                                return { key, val };
                            } catch {
                                const textVal = await env.PACKAGES.get(key, {
                                    type: "text",
                                });
                                return { key, val: textVal };
                            }
                        }),
                    );

                    for (const { key, val } of values) {
                        packageIndex[key] = val ?? null;
                    }

                    cursor = listResult.list_complete
                        ? undefined
                        : listResult.cursor;
                } while (cursor);

                return jsonResponse(packageIndex);
            }

            const singlePackageMatch = pathname.match(
                /^\/package\/([a-zA-Z0-9_\-\.]+)\.json$/,
            );
            if (singlePackageMatch) {
                const packageName = singlePackageMatch[1];
                if (!packageName) {
                    return jsonResponse({ error: "Invalid package name" }, 400);
                }

                if (!env.PACKAGES) {
                    return jsonResponse(
                        { error: "PACKAGES KV binding not configured" },
                        500,
                    );
                }

                let pkgData: unknown = null;
                try {
                    pkgData = await env.PACKAGES.get(packageName, {
                        type: "json",
                    });
                } catch {
                    pkgData = await env.PACKAGES.get(packageName, {
                        type: "text",
                    });
                }

                if (pkgData === null || pkgData === undefined) {
                    return jsonResponse(
                        {
                            error: "Package not found",
                            package: packageName,
                        },
                        404,
                    );
                }

                return jsonResponse(pkgData);
            }

            return jsonResponse({ error: "Not Found" }, 404);
        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : String(err);
            return jsonResponse(
                { error: "Internal Server Error", details: errorMessage },
                500,
            );
        }
    },
};
