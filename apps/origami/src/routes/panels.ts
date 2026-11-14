import { getPanelsIndex, getPanel, storeMediaPrefix, type PanelRecord } from "../panels";
import { jsonResponse, type Env } from "../lib";

// Read-only panel routes. Panel writes are operator actions through
// wrangler (apps/origami/scripts/lib/panelPublish.ts): there is no public
// publish route and no registry key. The registry serves what the operator
// wrote and verified.
export async function handlePanelsRoutes(
    request: Request,
    env: Env,
    pathname: string,
): Promise<Response | null> {
    const bucket = env.PANELS_BUCKET;
    if (
        pathname === "/panels/index.json" ||
        pathname === "/panels" ||
        pathname === "/panels/"
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

    const downloadMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/download$/,
    );
    if (downloadMatch && downloadMatch[1]) {
        // downloads are reads: any state-changing method is refused rather
        // than served with archive bytes
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
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

        // only the archive the registry hosts is served, never a URL the
        // record names; a missing one is the same 404 as a missing record
        return jsonResponse({ error: "Panel not found" }, 404);
    }

    const iconMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/icon(?:\.(png|svg|webp))?$/,
    );
    if (iconMatch && iconMatch[1]) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const panelId = iconMatch[1];
        // an icon is only served while its panel record is live: a
        // taken-down panel's branding must not outlive its record
        const record = await getPanel(env.PACKAGES, panelId);
        const object = record && bucket ? await iconObject(bucket, record) : null;
        if (!object) return jsonResponse({ error: "Icon not found" }, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        // icons share the library's origin and may be SVG documents:
        // sandboxed with nothing to load, an icon navigated to as a
        // top-level document cannot run script in the registry origin
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "public, max-age=86400");
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    const mediaMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+)\/media\/([a-zA-Z0-9._+-]+)\/([0-9]+-(?:light|dark)\.(?:png|webp|jpg|jpeg))$/,
    );
    if (mediaMatch) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const [, panelId, version, name] = mediaMatch;
        // only media the live record references is served: a taken-down
        // panel or a superseded release does not keep its screenshots public
        const record = await getPanel(env.PACKAGES, panelId!);
        const referenced = record?.store?.screenshots?.some((shot) =>
            [shot.light, shot.dark].some((u) =>
                typeof u === "string" && u.endsWith(`/panel/${panelId}/media/${version}/${name}`),
            ),
        );
        if (!record || !referenced || !bucket) {
            return jsonResponse({ error: "Media not found" }, 404);
        }
        const object = await bucket.get(`${storeMediaPrefix(panelId!)}${version}/${name}`);
        if (!object) return jsonResponse({ error: "Media not found" }, 404);
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(request.method === "HEAD" ? null : object.body, { headers });
    }

    const panelMatch = pathname.match(
        /^\/panel\/([a-zA-Z0-9_\-\.]+?)(?:\.json)?$/,
    );
    if (panelMatch && panelMatch[1]) {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return jsonResponse({ error: "Method Not Allowed" }, 405);
        }
        const record = await getPanel(env.PACKAGES, panelMatch[1]);
        if (!record) {
            return jsonResponse({ error: "Panel not found" }, 404);
        }
        return jsonResponse(record);
    }

    return null;
}

// The record names its icon. Records published before it did kept one
// fixed key per extension, so for those the first one stored is the icon
// until the panel's next release; a record with no icon serves none.
async function iconObject(bucket: R2Bucket, record: PanelRecord): Promise<R2ObjectBody | null> {
    if (record.iconKey) return bucket.get(record.iconKey);
    if (!record.iconUrl) return null;
    for (const ext of ["png", "svg", "webp"]) {
        const object = await bucket.get(`panels/${record.id}/icon.${ext}`);
        if (object) return object;
    }
    return null;
}
