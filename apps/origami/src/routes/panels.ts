import {
    getPanelsIndex,
    getPanel,
    savePanel,
    deletePanel,
    type PanelRecord,
} from "../panels";
import { jsonResponse, verifyAuth, type Env } from "../lib";

export async function handlePanelsRoutes(
    request: Request,
    env: Env,
    url: URL,
    pathname: string,
    bucket: R2Bucket | undefined,
): Promise<Response | null> {
    if (
        pathname === "/panels/index.json" ||
        pathname === "/panels" ||
        pathname === "/panels/" ||
        pathname === "/boards/index.json" ||
        pathname === "/boards" ||
        pathname === "/boards/"
    ) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }

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
            const metadataRaw = formData.get("metadata") as string | null;

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
    if (iconMatch && iconMatch[1]) {
        if (request.method !== "GET") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
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
    if (panelMatch && panelMatch[1]) {
        if (request.method === "GET") {
            const panelId = panelMatch[1];
            const record = await getPanel(env.PACKAGES, panelId);

            if (!record) {
                return jsonResponse({ error: "Panel not found" }, 404);
            }

            return jsonResponse(record);
        }

        if (request.method === "DELETE") {
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

        return jsonResponse({ error: "Method Not Allowed" }, 405);
    }

    return null;
}
