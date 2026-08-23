import { updateJavaPackages } from "./updateJava";
import {
    getPanelsIndex,
    getPanel,
    savePanel,
    deletePanel,
    type PanelRecord,
} from "./panels";

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

        const bucket = env.PANELS_BUCKET || env.BOARDS_BUCKET;
        const url = new URL(request.url);
        const pathname = url.pathname;

        try {
            if (pathname === "/" || pathname === "/health") {
                return jsonResponse({
                    service: "Origami Package & Panel Registry",
                    status: "healthy",
                    endpoints: [
                        "/package/:name.json",
                        "/package/index.json",
                        "/panels/index.json",
                        "/panel/:id.json",
                        "/panel/:id/download",
                        "/panel/publish",
                        "/boards/index.json",
                        "/board/:id.json",
                        "/board/:id/download",
                        "/board/publish",
                        "/update/java",
                        "/paperdl/:app/index.json",
                        "/paperdl/:app/confirm",
                        "/paperdl/:app/:target/download",
                        "/paperdl/paperboard/latest.yml",
                        "/paperdl/paperboard/latest-mac.yml",
                        "/paperdl/paperboard/latest-linux.yml",
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
                pathname === "/panels/index.json" ||
                pathname === "/panels" ||
                pathname === "/panels/" ||
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

                const index = await getPanelsIndex(env.PACKAGES);
                return jsonResponse(index);
            }

            if (
                pathname === "/panel/publish" ||
                pathname === "/panels/publish" ||
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

                    let metadata: Partial<PanelRecord>;
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

                    const archiveKey = `panels/${metadata.id}/${metadata.id}-${metadata.version}.tar.gz`;

                    if (bucket) {
                        await bucket.put(archiveKey, archiveBuffer, {
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
                    if (iconFile && bucket) {
                        const iconExt = iconFile.name.endsWith(".svg")
                            ? "svg"
                            : iconFile.name.endsWith(".webp")
                              ? "webp"
                              : "png";
                        const iconKey = `panels/${metadata.id}/icon.${iconExt}`;
                        const iconBuffer = await iconFile.arrayBuffer();
                        await bucket.put(iconKey, iconBuffer, {
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
                        iconUrl = `${url.origin}/panel/${metadata.id}/icon`;
                    }

                    const record: PanelRecord = {
                        id: metadata.id,
                        name: metadata.name,
                        version: metadata.version,
                        description: metadata.description,
                        icon: metadata.icon,
                        iconUrl,
                        archiveKey,
                        sha256,
                        sizeBytes,
                        downloadUrl: `${url.origin}/panel/${metadata.id}/download`,
                        updatedAt: new Date().toISOString(),
                        manifest: metadata.manifest || (metadata as any),
                    };

                    await savePanel(env.PACKAGES, record);
                    return jsonResponse({
                        success: true,
                        panel: record,
                        board: record,
                    });
                }

                const body = (await request.json()) as Partial<PanelRecord>;
                if (!body.id || !body.name || !body.version) {
                    return jsonResponse(
                        {
                            error: "Metadata must include 'id', 'name', and 'version'",
                        },
                        400,
                    );
                }

                const record: PanelRecord = {
                    id: body.id,
                    name: body.name,
                    version: body.version,
                    description: body.description,
                    icon: body.icon,
                    downloadUrl:
                        body.downloadUrl ||
                        `${url.origin}/panel/${body.id}/download`,
                    sha256: body.sha256,
                    sizeBytes: body.sizeBytes,
                    updatedAt: new Date().toISOString(),
                    manifest: body.manifest || (body as any),
                };

                await savePanel(env.PACKAGES, record);
                return jsonResponse({
                    success: true,
                    panel: record,
                    board: record,
                });
            }

            const downloadMatch = pathname.match(
                /^\/(?:panel|board)\/([a-zA-Z0-9_\-\.]+)\/download$/,
            );
            if (downloadMatch && downloadMatch[1]) {
                const panelId = downloadMatch[1];
                const record = await getPanel(env.PACKAGES, panelId);

                if (!record) {
                    return jsonResponse({ error: "Panel not found" }, 404);
                }

                if (bucket && record.archiveKey) {
                    const object = await bucket.get(record.archiveKey);
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

            const iconMatch = pathname.match(
                /^\/(?:panel|board)\/([a-zA-Z0-9_\-\.]+)\/icon(?:\.(png|svg|webp))?$/,
            );
            if (iconMatch && iconMatch[1] && request.method === "GET") {
                const panelId = iconMatch[1];
                if (bucket) {
                    for (const ext of ["png", "svg", "webp"]) {
                        let object = await bucket.get(
                            `panels/${panelId}/icon.${ext}`,
                        );
                        if (!object) {
                            object = await bucket.get(
                                `boards/${panelId}/icon.${ext}`,
                            );
                        }
                        if (object) {
                            const headers = new Headers();
                            object.writeHttpMetadata(headers);
                            headers.set(
                                "Cache-Control",
                                "public, max-age=86400",
                            );
                            headers.set("Access-Control-Allow-Origin", "*");
                            return new Response(object.body, { headers });
                        }
                    }
                }
                return jsonResponse({ error: "Icon not found" }, 404);
            }

            const panelMatch = pathname.match(
                /^\/(?:panel|board)\/([a-zA-Z0-9_\-\.]+)(?:\.json)?$/,
            );
            if (panelMatch && panelMatch[1] && request.method === "GET") {
                const panelId = panelMatch[1];
                const record = await getPanel(env.PACKAGES, panelId);

                if (!record) {
                    return jsonResponse({ error: "Panel not found" }, 404);
                }

                return jsonResponse(record);
            }

            if (panelMatch && panelMatch[1] && request.method === "DELETE") {
                if (!verifyAuth(request, env)) {
                    return jsonResponse({ error: "Unauthorized" }, 401);
                }

                const panelId = panelMatch[1];
                const deleted = await deletePanel(
                    env.PACKAGES,
                    bucket,
                    panelId,
                );

                if (!deleted) {
                    return jsonResponse({ error: "Panel not found" }, 404);
                }

                return jsonResponse({ success: true, deletedId: panelId });
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
                                !name.startsWith("panel:") &&
                                !name.startsWith("panels:") &&
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

            // ── paperdl: binary distribution for crane and paperboard ──────────────
            const paperdlMatch = pathname.match(
                /^\/paperdl\/(crane|paperboard)(\/.*)?$/,
            );
            if (paperdlMatch) {
                const app = paperdlMatch[1] as "crane" | "paperboard";
                const sub = paperdlMatch[2] || "";
                const dl = env.PAPERDL_BUCKET;

                // GET index
                if (
                    request.method === "GET" &&
                    (sub === "/index.json" || sub === "" || sub === "/")
                ) {
                    if (!dl) {
                        return jsonResponse(
                            { error: "PAPERDL_BUCKET not configured" },
                            500,
                        );
                    }
                    const obj = await dl.get(`${app}/index.json`);
                    if (!obj) return jsonResponse({});
                    const text = await obj.text();
                    return new Response(text, {
                        headers: {
                            "Content-Type": "application/json",
                            "Cache-Control": "no-cache",
                            "Access-Control-Allow-Origin": "*",
                        },
                    });
                }

                // GET electron-updater YAML feeds  (paperboard only)
                if (
                    request.method === "GET" &&
                    app === "paperboard" &&
                    (sub === "/latest.yml" ||
                        sub === "/latest-mac.yml" ||
                        sub === "/latest-linux.yml")
                ) {
                    if (!dl) {
                        return jsonResponse(
                            { error: "PAPERDL_BUCKET not configured" },
                            500,
                        );
                    }
                    const obj = await dl.get(`paperboard${sub}`);
                    if (!obj) return jsonResponse({ error: "Not found" }, 404);
                    return new Response(obj.body, {
                        headers: {
                            "Content-Type": "text/yaml; charset=utf-8",
                            "Cache-Control": "no-cache",
                            "Access-Control-Allow-Origin": "*",
                        },
                    });
                }

                // GET binary download
                const dlMatch = sub.match(/^\/([a-zA-Z0-9_\-]+)\/download$/);
                if (request.method === "GET" && dlMatch && dlMatch[1]) {
                    if (!dl) {
                        return jsonResponse(
                            { error: "PAPERDL_BUCKET not configured" },
                            500,
                        );
                    }
                    const target = dlMatch[1];
                    const obj = await dl.get(`${app}/${target}`);
                    if (!obj) return jsonResponse({ error: "Not found" }, 404);
                    const headers = new Headers();
                    obj.writeHttpMetadata(headers);
                    headers.set("etag", obj.httpEtag);
                    headers.set("Cache-Control", "no-cache");
                    headers.set("Access-Control-Allow-Origin", "*");
                    const meta = obj.customMetadata || {};
                    if (meta.filename) {
                        headers.set(
                            "Content-Disposition",
                            `attachment; filename="${meta.filename}"`,
                        );
                    }
                    return new Response(obj.body, { headers });
                }

                // POST confirm  (auth required, JSON only — binary was uploaded directly to R2)
                // @ts-ignore it put an error there that was stupid
                if (sub === "/confirm" && request.method === "POST") {
                    if (!verifyAuth(request, env)) {
                        return jsonResponse({ error: "Unauthorized" }, 401);
                    }
                    if (!dl) {
                        return jsonResponse(
                            { error: "PAPERDL_BUCKET not configured" },
                            500,
                        );
                    }
                    if (!env.PACKAGES) {
                        return jsonResponse(
                            { error: "PACKAGES KV not configured" },
                            500,
                        );
                    }

                    const body = (await request.json()) as {
                        target?: string;
                        version?: string;
                        filename?: string;
                        sha256?: string;
                        sha512?: string;
                        sizeBytes?: number;
                        downloadUrl?: string;
                    };
                    const {
                        target,
                        version,
                        filename,
                        sha256,
                        sha512,
                        sizeBytes,
                        downloadUrl,
                    } = body;

                    if (!target || !version || !sha256 || !sha512) {
                        return jsonResponse(
                            {
                                error: "body must include target, version, sha256, sha512",
                            },
                            400,
                        );
                    }

                    // Update KV index
                    const existing = ((await env.PACKAGES.get(
                        `paperdl:${app}:index`,
                        { type: "json" },
                    )) || {}) as Record<string, unknown>;
                    existing[target] = {
                        target,
                        version,
                        filename: filename || target,
                        sha256,
                        sha512,
                        sizeBytes: sizeBytes ?? 0,
                        downloadUrl:
                            downloadUrl ??
                            `${url.origin}/paperdl/${app}/${target}/download`,
                        publishedAt: new Date().toISOString(),
                    };
                    await env.PACKAGES.put(
                        `paperdl:${app}:index`,
                        JSON.stringify(existing),
                    );

                    // For paperboard: write electron-updater YAML feeds
                    if (app === "paperboard") {
                        const dlUrl =
                            downloadUrl ??
                            `${url.origin}/paperdl/paperboard/${target}/download`;
                        const yamlContent = [
                            `version: ${version}`,
                            `files:`,
                            `  - url: ${dlUrl}`,
                            `    sha512: ${sha512}`,
                            `    size: ${sizeBytes ?? 0}`,
                            `path: ${dlUrl}`,
                            `sha512: ${sha512}`,
                            `releaseDate: '${new Date().toISOString()}'`,
                        ].join("\n");

                        let ymlKey: string | null = null;
                        if (target.startsWith("windows"))
                            ymlKey = "paperboard/latest.yml";
                        else if (target.startsWith("macos"))
                            ymlKey = "paperboard/latest-mac.yml";
                        else if (target.startsWith("linux"))
                            ymlKey = "paperboard/latest-linux.yml";

                        if (ymlKey) {
                            await dl.put(ymlKey, yamlContent, {
                                httpMetadata: { contentType: "text/yaml" },
                            });
                        }
                    }

                    return jsonResponse({
                        success: true,
                        app,
                        target,
                        version,
                        sha256,
                        downloadUrl:
                            downloadUrl ??
                            `${url.origin}/paperdl/${app}/${target}/download`,
                    });
                }
            }
            // ─────────────────────────────────────────────────────────────────────

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
