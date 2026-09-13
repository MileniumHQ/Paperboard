import { jsonResponse, type Env } from "../lib";

export async function handlePaperdlRoutes(
    request: Request,
    env: Env,
    _url: URL,
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
            let filename = meta.filename ?? "";
            if (trailingName) {
                try {
                    filename = decodeURIComponent(trailingName);
                } catch (err) {
                    console.warn(
                        `[origami] paperdl: undecodable download filename for ${app}/${target}:`,
                        err instanceof Error ? err.message : String(err),
                    );
                    return jsonResponse(
                        { error: "Invalid download filename encoding" },
                        400,
                    );
                }
            }
            // Content-Disposition is a header: control characters (newlines,
            // CR, NUL, …) would throw inside Headers.set. Strip them and the
            // quote/backslash breakouts before the value goes anywhere near
            // a header.
            filename = filename.replace(/[\x00-\x1f\x7f"\\]/g, "");
            if (trailingName && !filename) {
                return jsonResponse(
                    { error: "Invalid download filename" },
                    400,
                );
            }
            if (filename) {
                headers.set(
                    "Content-Disposition",
                    `attachment; filename="${filename}"`,
                );
            }
            return new Response(obj.body, { headers });
        }
    }

    return null;
}
