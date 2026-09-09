import { jsonResponse, verifyAuth, type Env } from "../lib";

export async function handlePaperdlRoutes(
    request: Request,
    env: Env,
    url: URL,
    pathname: string,
    _bucket: R2Bucket | undefined,
): Promise<Response | null> {
    const paperdlMatch = pathname.match(
        /^\/paperdl\/(crane|paperboard)(\/.*)?$/,
    );
    if (paperdlMatch) {
        const app = paperdlMatch[1] as "crane" | "paperboard";
        const sub = paperdlMatch[2] || "";
        const dl = env.PAPERDL_BUCKET;

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

        // trailing path segment becomes the download filename
        const dlMatch = sub.match(/^\/([a-zA-Z0-9_\-]+)\/download(?:\/.*)?$/);
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
            // Versioned binaries are immutable; index/latest YAML stay no-cache (see below)
            headers.set("Cache-Control", "public, max-age=31536000, immutable");
            headers.set("Access-Control-Allow-Origin", "*");
            const meta = obj.customMetadata || {};
            // Trailing filename wins over stored metadata
            const trailingName =
                sub.match(/^\/[a-zA-Z0-9_\-]+\/download\/([^\r\n]+)$/)?.[1]?.split("/").pop() || "";
            const filename =
                (trailingName && decodeURIComponent(trailingName)) ||
                meta.filename;
            if (filename) {
                headers.set(
                    "Content-Disposition",
                    `attachment; filename="${filename.replace(/"/g, "")}"`,
                );
            }
            return new Response(obj.body, { headers });
        }

        // POST confirm, binary already in R2
        // @ts-ignore
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

            if (!target || !version || !sha256 || !sha512 || typeof sizeBytes !== "number") {
                return jsonResponse(
                    {
                        error: "body must include target, version, sha256, sha512, sizeBytes",
                    },
                    400,
                );
            }

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
                sizeBytes,
                downloadUrl:
                    downloadUrl ??
                    `${url.origin}/paperdl/${app}/${target}/download`,
                publishedAt: new Date().toISOString(),
            };
            await env.PACKAGES.put(
                `paperdl:${app}:index`,
                JSON.stringify(existing),
            );

            if (app === "paperboard") {
                const dlUrl =
                    downloadUrl ??
                    `${url.origin}/paperdl/paperboard/${target}/download`;
                const yamlContent = [
                    `version: ${version}`,
                    `files:`,
                    `  - url: ${dlUrl}`,
                    `    sha512: ${sha512}`,
                    `    size: ${sizeBytes}`,
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

    return null;
}
